"""Recover transient Spaces failures at the failed stage, preserving completed clips.

Uses gradio_client 2.7.1. Only metadata reads and file uploads retry internally.
Explicit HTTP 5xx and completed upstream errors retry with a bounded backoff.
A connection timeout is ambiguous, so it never triggers a new GPU submission.
"""
import json
import re
import time
from urllib.parse import urlsplit
from datetime import datetime, timezone
from pathlib import Path
from collections import deque
from gradio_client.utils import ServerMessage

import httpx
from gradio_client import Client
from gradio_client.client import Endpoint
from gradio_client.exceptions import AppError

TRANSIENT = {500, 502, 503, 504}
LOG = Path(__file__).with_name('http-errors.jsonl')


def transient(error):
    if isinstance(error, httpx.HTTPStatusError):
        return error.response.status_code in TRANSIENT
    if isinstance(error, AppError):
        # This is a terminal failure delivered by the queue, not a lost stream.
        return str(error) == "Workflow node failed" or bool(re.search(r"Server error '50[0234]|Could not fetch (config|api info)|Could not get Gradio config", str(error)))
    return False


def record(error, stage):
    row = {'at': datetime.now(timezone.utc).isoformat(), 'stage': stage,
           'error': type(error).__name__}
    if isinstance(error, httpx.HTTPStatusError):
        response = error.response
        row.update(status=response.status_code, host=response.request.url.host,
                   path=response.request.url.path,
                   request_id=response.headers.get('x-request-id'),
                   server=response.headers.get('server'),
                   replica=response.headers.get('x-proxied-replica'))
    elif isinstance(error, AppError):
        message = str(error)
        status = re.search(r"Server error '(50[0234])|<h1>(50[0234])</h1>", message)
        url = re.search(r'https://[\w.-]+\.hf\.space[^\s\'"<>]*', message)
        if status: row['status'] = int(status.group(1) or status.group(2))
        if url:
            parts = urlsplit(url.group().rstrip(':'))
            row.update(host=parts.hostname, path=parts.path)
        if 'api info' in message: row['remote_stage'] = 'api-info'
        elif 'config' in message: row['remote_stage'] = 'config'
    # Never log auth headers, cookies, image bodies or token-bearing query strings.
    with LOG.open('a') as file:
        file.write(json.dumps(row)+'\n')


def recover(operation, stage, attempts=6):
    for attempt in range(attempts):
        try:
            return operation()
        except (httpx.HTTPError, AppError) as error:
            record(error, stage)
            safe_transport = stage in ('event-stream', 'upload', 'download', '/config', '/gradio_api/info') and isinstance(error, httpx.TransportError)
            if not (transient(error) or safe_transport) or attempt == attempts-1:
                raise
            delay = min(5 * 2**attempt, 60)
            print(f'{stage}: temporary upstream failure; retry {attempt+1}/{attempts-1} in {delay}s', flush=True)
            time.sleep(delay)


class AnimationEndpoint(Endpoint):
    def _download_file(self, file):
        return recover(lambda: super(AnimationEndpoint, self)._download_file(file), 'download')

    def _upload_file(self, file, data_index):
        path = Path(file['path'])
        if not path.is_file():
            return super()._upload_file(file, data_index)
        stat = path.stat()
        key = (str(path.resolve()), stat.st_size, stat.st_mtime_ns)
        cache = self.client.animation_uploads
        if key not in cache:
            cache[key] = recover(lambda: super(AnimationEndpoint, self)._upload_file(file, data_index), 'upload')
        return dict(cache[key])


class AnimationClient(Client):
    def __init__(self, *args, **kwargs):
        self.animation_uploads = {}
        super().__init__(*args, **kwargs)
        self.endpoints = {key: AnimationEndpoint(self, endpoint.fn_index, endpoint.dependency, endpoint.protocol)
                          for key, endpoint in self.endpoints.items()}

    def _metadata(self, suffix):
        def fetch():
            response = httpx.get(self.src.rstrip('/') + suffix, headers=self.headers,
                                 cookies=self.cookies, verify=self.ssl_verify, **self.httpx_kwargs)
            response.raise_for_status()
            self.cookies.update(response.cookies)
            return response.json()
        return recover(fetch, suffix)

    def _get_config(self):
        return self._metadata('/config')

    def _get_api_info(self):
        return self._metadata('/gradio_api/info')

    def generate(self, **kwargs):
        def completed_job():
            job = self.submit(**kwargs)
            previous = None
            while not job.done():
                status = str(job.status().code)
                if status != previous:
                    print(status, flush=True)
                    previous = status
                time.sleep(3)
            return job.result()
        # Keep explicit HTTP failures distinct from a lost network response.
        def retry_completed():
            try:
                return completed_job()
            except httpx.HTTPStatusError:
                raise
            except httpx.HTTPError as error:
                record(error, 'queue-ambiguous')
                raise RuntimeError('Queue request failed; inspect the job before resubmitting.') from error
        return recover(retry_completed, 'completed-remote-job')

    def _stream_messages_once(
        self,
        protocol,
        session_hash: str,
    ) -> None:
        httpx_kwargs = self.httpx_kwargs.copy()
        httpx_kwargs.setdefault("timeout", httpx.Timeout(timeout=None))
        with httpx.Client(
            verify=self.ssl_verify,
            **httpx_kwargs,
        ) as client:
            with client.stream(
                "GET",
                self.sse_url,
                params={"session_hash": session_hash},
                headers=self.headers,
                cookies=self.cookies,
            ) as response:
                response.raise_for_status()
                buffer = b""
                for chunk in response.iter_bytes():
                    buffer += chunk
                    while b"\n\n" in buffer:
                        line, buffer = buffer.split(b"\n\n", 1)
                        line = line.decode("utf-8").rstrip("\n")
                        if not len(line):
                            continue
                        if line.startswith("data:"):
                            resp = json.loads(line[5:])
                            if resp["msg"] == ServerMessage.heartbeat:
                                continue
                            elif (
                                resp.get("message", "")
                                == ServerMessage.server_stopped
                            ):
                                with self.pending_lock:
                                    pending = list(
                                        self.pending_messages_per_event.values()
                                    )
                                for pending_messages in pending:
                                    pending_messages.append(resp)
                                return
                            elif resp["msg"] == ServerMessage.close_stream:
                                with self.pending_lock:
                                    self.stream_open = False
                                return
                            event_id = resp["event_id"]
                            with self.pending_lock:
                                if event_id not in self.pending_messages_per_event:
                                    self.pending_messages_per_event[event_id] = (
                                        deque()
                                    )
                                self.pending_messages_per_event[event_id].append(
                                    resp
                                )
                                if resp["msg"] == ServerMessage.process_completed:
                                    # The submitting thread may not have got here yet.
                                    self.pending_event_ids.discard(event_id)
                                close = (
                                    len(self.pending_event_ids) == 0
                                    and protocol != "sse_v3"
                                )
                                if close:
                                    self.stream_open = False
                            if close:
                                return
                        else:
                            raise ValueError(f"Unexpected SSE line: '{line}'")

    def stream_messages(self, protocol, session_hash):
        return recover(lambda: self._stream_messages_once(protocol, session_hash), "event-stream")

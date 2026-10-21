# MiniMax generation failure diagnosis — 2026-09-28 (Chile)

## Confirmed failure chain

A generation crosses 2 public Spaces:

1. Our client uploads to MiniMax.
2. The MiniMax application creates a Gradio client. It uploads both keyframes
   again to `multimodalart/qwen3vl-conditioner`.
3. Only after conditioning does it run denoising.

The conditioner client in the Space source has no request-level retry.

The 500/502 failures reproduce without gradio_client, prompts, video generation
or GPU allocation. Of 12 direct HTTP uploads of the same PNG, 10 succeeded and 2
returned 502. Both Spaces failed. A bearer-token request failed
and then succeeded. An x-hf-authorization request succeeded and then failed.

Successful responses identify `server: uvicorn` and a Space replica. Failed
responses return the Hugging Face HTML error page without those
application/replica headers, but with provider request IDs:

- MiniMax upload: `BMg6Il` (502), later `Sz_iLG` (200).
- Conditioner upload: `BjpE_u` (502), earlier `zcRu-a` (200).
- Actual Gradio upload: `otXUBU` (502), adjacent uploads reached the same
  `fykk4jav-h6szm` replica successfully.

This places the failures on the remote Spaces access/proxy/upstream path, not a
deterministic image or prompt error. It does **not** prove the provider cause:
proxy process, routing, connection reset, pod pressure or something else.
Both run-log endpoints deny this account access (403). Claiming OOM or a global
outage would be unsupported.

Both Spaces reported RUNNING while requests failed. 8 config/API-info probes
(authenticated and anonymous) all succeeded just before failed uploads. The
status page reported operational. Neither is an end-to-end health check.

- `whoami-v2` confirmed `emersoftware`, `isPro: true`, OAuth authentication.
- The client sends the token as `x-hf-authorization`. A false
  `authorization_header_present` in the trace does NOT mean anonymous access.
- No proxy environment variables were set. TLS verification stayed enabled.

## Local contributor and correction

The old runner:

- Treated all exceptions as transient and restarted the entire client.
- Uploaded the same image twice.
- Gave up on the batch after 4 attempts, with a fixed 10-second delay.
- The SDK replaced metadata HTTP errors with large generic exceptions, hiding
  request IDs and status.

`space_client.py` now:

- Retries failed metadata and upload stages separately.
- Reuses 1 uploaded image for matching first/last frames.
- Backs off for 5/10/20/40/60 seconds.
- Retries explicit 500/502/503/504 responses and terminal remote dependency
  errors. Auth, input and quota errors stop at once.
- Never resubmits GPU jobs automatically on connection timeouts.
- Keeps reusing completed result JSONs and videos.
- Records status, host, stage, request ID and replica where available, without
  credentials.

Explicit HTTP 5xx retries are bounded. A gateway error after server acceptance
can still cause duplicate work: the upstream API has no client idempotency key.

4 focused tests cover a failed upload then success, first/last reuse, permanent
auth/quota rejection, and no resubmission after a lost response.

## Evidence and sources

- `upload-probe.jsonl`: independent raw HTTP reproduction (no GPU jobs).
- `gradio-http-trace.jsonl`: actual failed and successful generation requests.
- `../http-errors.jsonl`: ongoing sanitized stage errors.
- MiniMax source: https://huggingface.co/spaces/MiniMaxAI/MiniMax-H3-Turbo-Lora/blob/9a76d679e4197339c32b115d3eebe435d43b373a/app.py
- Conditioner source: https://huggingface.co/spaces/multimodalart/qwen3vl-conditioner/blob/71cd9793a2dde2c195ae99043368993f8391002b/app.py
- Supported auth/API use: https://huggingface.co/docs/hub/spaces-api-endpoints

Run the pinned client and tests:

```sh
uv run --with gradio_client==2.7.1 python -m unittest discover -s assets/animations -p test_space_client.py -v
uv run --with gradio_client==2.7.1 python assets/animations/generate-units.py king --action walk
```

## Live validation

The corrected client hit a real 502 on `/config` (request `o8LX4-`), retried that
stage after 5 seconds, then completed and saved the pending King south
continuous-walk clip. This confirms recovery end to end. It does not repair
Hugging Face infrastructure or stop future failures.

## Additional failure: event-stream HTTP handling

A live north-walk attempt: `/queue/join` was accepted, then `/queue/data` returned
an HTML error page. gradio_client 2.7.1 `stream_messages` does not check the HTTP
status before it parses SSE. It raised `Unexpected SSE line: <!DOCTYPE
html>`, and the pending job surfaced as `CancelledError`.

The same SDK pattern inside the public Space can produce an empty exception.
Gradio Workflow turns an empty error into `Workflow node failed`. That link is
based on the source, not an observed internal stack (public logs stay denied).

The local client now checks stream status and, on a transient HTTP/transport
failure, reconnects the **same session and job**. A 5th test serves a 502 HTML
page, then a completion event, and checks both requests are GETs for the same
session with no 2nd GPU submission. Output downloads also retry separately.

## Private ZeroGPU worker

A private ZeroGPU copy, `emersoftware/aoa-minimax-animation-worker`, runs the same
correction on the generator-to-conditioner connection. It uses the public model
and the included ZeroGPU allocation; no paid GPU hardware was requested.

Its first build exposed old upstream pins conflicting with the current platform
(`spaces==0.51.1` vs required `0.51.3`). The private copy now uses
`spaces==0.51.3`, stable `gradio==6.28.0` and `gradio-client==2.7.1` together.

- The private Space built and reached RUNNING on ZeroGPU.
- It completed Ranger south death and King NE/N continuous walks.
- The local client recovered real `/gradio_api/info` and `/queue/join` 502s
  in the next batch.
- Owner runtime logs are now available for private worker failures.

This confirms the corrected path, without claiming upstream outages are gone.

Private output routes need authentication too. Saved results download with a
standard Authorization header only for the selected Space host; HTTPX drops it if
a redirect crosses origins. A failed download reuses its saved result JSON instead
of generating another video.

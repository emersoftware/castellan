import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import httpx
import threading
from collections import deque
from gradio_client.exceptions import AppError
from space_client import AnimationClient, AnimationEndpoint, recover

class RecoveryTests(unittest.TestCase):
    def test_error_page_reconnects_same_event_stream_without_resubmission(self):
        client=object.__new__(AnimationClient)
        client.animation_attempts=6
        client.httpx_kwargs={};client.ssl_verify=True;client.headers={};client.cookies={}
        client.sse_url='https://example.test/queue/data';client.pending_lock=threading.Lock()
        client.pending_messages_per_event={'job-a':deque()};client.pending_event_ids={'job-a'}
        calls=[]
        def handler(request):
            calls.append(request)
            if len(calls)==1:return httpx.Response(502,text='<html>bad gateway</html>')
            return httpx.Response(200,text='data: {"msg":"process_completed","event_id":"job-a","output":{"data":["video"]}}\n\n')
        real_client=httpx.Client
        with patch('space_client.httpx.Client',side_effect=lambda **kw:real_client(transport=httpx.MockTransport(handler))),patch('space_client.time.sleep'),patch('space_client.record'):
            client.stream_messages('sse_v2','same-session')
        self.assertEqual(len(calls),2)
        self.assertTrue(all(r.method=='GET' and r.url.params['session_hash']=='same-session' for r in calls))
        self.assertEqual(client.pending_messages_per_event['job-a'][0]['output']['data'],['video'])
    def test_upload_recovers_502_and_reuses_identical_first_last_frame(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'sprite.png';path.write_bytes(b'png')
            endpoint=object.__new__(AnimationEndpoint)
            endpoint.client=SimpleNamespace(animation_uploads={},animation_attempts=6)
            bad=httpx.HTTPStatusError('upstream',request=httpx.Request('POST','https://example.test/upload'),response=httpx.Response(502,request=httpx.Request('POST','https://example.test/upload')))
            with patch('space_client.Endpoint._upload_file',side_effect=[bad,{'path':'/tmp/gradio/sprite.png'}]) as upload, patch('space_client.time.sleep'), patch('space_client.record'):
                a=endpoint._upload_file({'path':str(path)},0)
                b=endpoint._upload_file({'path':str(path)},1)
                self.assertEqual(a,b);self.assertEqual(upload.call_count,2)
    def test_auth_failure_is_not_retried(self):
        req=httpx.Request('GET','https://example.test/config')
        error=httpx.HTTPStatusError('auth',request=req,response=httpx.Response(401,request=req))
        with patch('space_client.time.sleep') as sleep,patch('space_client.record'):
            with self.assertRaises(httpx.HTTPStatusError):recover(lambda: (_ for _ in ()).throw(error),'config')
            sleep.assert_not_called()
    def test_explicit_dependency_failure_retries_but_quota_does_not(self):
        with patch('space_client.time.sleep'),patch('space_client.record'):
            from unittest.mock import Mock
            operation=Mock(side_effect=[AppError("Server error '502 Bad Gateway' for url 'https://conditioner.test/upload'"),'video'])
            self.assertEqual(recover(operation,'job'),'video')
            operation=Mock(side_effect=AppError('GPU quota exceeded'))
            with self.assertRaises(AppError):recover(operation,'job')
            self.assertEqual(operation.call_count,1)
    def test_lost_submission_response_never_launches_second_job(self):
        client=object.__new__(AnimationClient)
        client.animation_attempts=6
        request=httpx.Request('POST','https://example.test/queue/join')
        with patch.object(client,'submit',side_effect=httpx.ReadTimeout('lost',request=request)) as submit,patch('space_client.record'):
            with self.assertRaisesRegex(RuntimeError,'inspect the job'):client.generate(api_name='/output_video')
            self.assertEqual(submit.call_count,1)

    def test_single_attempt_never_resubmits_completed_upstream_failure(self):
        from unittest.mock import Mock
        client=object.__new__(AnimationClient)
        client.animation_attempts=1
        job=Mock();job.done.return_value=True
        job.result.side_effect=AppError('Workflow node failed')
        with patch.object(client,'submit',return_value=job) as submit,patch('space_client.time.sleep') as sleep,patch('space_client.record'):
            with self.assertRaises(AppError):client.generate(api_name='/output_video')
            self.assertEqual(submit.call_count,1)
            sleep.assert_not_called()

if __name__=='__main__':unittest.main()

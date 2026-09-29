# MiniMax generation failure diagnosis — 2026-09-28 (Chile)

## Confirmed failure chain

A generation crosses two public Spaces: our client uploads to MiniMax, then the
MiniMax application creates a Gradio client and uploads both keyframes again to
`multimodalart/qwen3vl-conditioner`. Only after conditioning does it run denoising.
The conditioner client in the Space source has no request-level retry.

The 500/502 failures are reproducible independently of gradio_client, prompts,
video generation, and GPU allocation. In 12 direct HTTP uploads of exactly the
same PNG, 10 succeeded and 2 returned 502. Both Spaces failed. A bearer-token
request failed and then succeeded; an x-hf-authorization request also succeeded
and then failed. The successful responses identify `server: uvicorn` and a
Space replica. Failed responses return Hugging Face's HTML error page without
those application/replica headers, but with provider request IDs:

- MiniMax upload: `BMg6Il` (502), later `Sz_iLG` (200).
- Conditioner upload: `BjpE_u` (502), earlier `zcRu-a` (200).
- Actual Gradio upload: `otXUBU` (502), adjacent uploads reached the same
  `fykk4jav-h6szm` replica successfully.

This localizes the observed failures to the remote Spaces access/proxy/upstream
path, rather than a deterministic image or prompt error. It does **not** prove
whether the underlying provider issue is a proxy process, routing, connection
reset, pod pressure, or another internal cause. Both run-log endpoints deny this
account access (403). Claiming OOM or a global outage would be unsupported.

Both Spaces reported RUNNING while requests failed. Eight config/API-info probes
(authenticated and anonymous) all succeeded immediately before failed uploads.
The status page reported operational. Neither is an end-to-end health check.
`whoami-v2` confirmed `emersoftware`, `isPro: true`, OAuth authentication. The
client sends the token as `x-hf-authorization`; a false
`authorization_header_present` in the trace does NOT mean anonymous access.
No proxy environment variables were set. TLS verification remained enabled.

## Local contributor and correction

The old runner treated all exceptions as transient, restarted the entire client,
reuploaded the same image twice, and abandoned the batch after four attempts
with a fixed 10-second delay. The SDK also replaced metadata HTTP errors with
large generic exceptions, hiding request IDs and status.

`space_client.py` now retries failed metadata and upload stages separately,
reuses an uploaded image for matching first/last frames, and backs off for
5/10/20/40/60 seconds. It retries explicit 500/502/503/504 responses and terminal
remote dependency errors; auth, input, and quota errors stop immediately.
Connection timeouts do not automatically resubmit GPU jobs. Explicit HTTP 5xx
retries are bounded, but a gateway error after server acceptance can still
cause duplicate work: the upstream API has no client idempotency key.
Completed result JSONs and videos continue to be reused. Error records contain
status, host, stage, request ID and replica where available, without credentials.

Four focused tests cover a failed upload followed by success, first/last reuse,
permanent auth/quota rejection, and avoiding resubmission after a lost response.

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

The corrected client encountered a real 502 on `/config` (request `o8LX4-`),
retried that stage after 5 seconds, and then completed and saved the pending
King south continuous-walk clip. This validates recovery end to end; it does
not claim to repair Hugging Face infrastructure or eliminate future failures.

## Additional failure: event-stream HTTP handling

A live north-walk attempt accepted `/queue/join`, then `/queue/data` returned
an HTML error page. gradio_client 2.7.1 `stream_messages` does not check the
HTTP status before parsing SSE. It raised `Unexpected SSE line: <!DOCTYPE
html>`, and the pending job surfaced as `CancelledError`. The same SDK pattern
inside the public Space can produce an empty exception; Gradio Workflow turns
an empty error into `Workflow node failed`. The latter connection is a source-
based explanation, not an observed internal stack (public logs remain denied).

The local client now checks stream status and reconnects the **same session and
job** on a transient HTTP/transport failure. A fifth test serves a 502 HTML page
then a completion event and verifies that both requests are GETs for the same
session, with no second GPU submission. Output downloads also retry separately.

A private ZeroGPU copy, `emersoftware/aoa-minimax-animation-worker`, was created
so the same correction can run on the generator-to-conditioner connection. It
uses the public model and included ZeroGPU allocation; no paid GPU hardware was
requested. Its first build exposed old upstream pins conflicting with the
current platform (`spaces==0.51.1` vs required `0.51.3`). The private copy now
uses `spaces==0.51.3`, stable `gradio==6.28.0`, and `gradio-client==2.7.1` together.
The private Space built successfully and reached RUNNING on ZeroGPU. It completed
Ranger south death and King NE/N continuous walks. The local client also recovered
real `/gradio_api/info` and `/queue/join` 502s during the subsequent batch. Owner
runtime logs are now accessible for failures inside the private worker. This
validates the corrected path without claiming that upstream outages are eliminated.

Private output routes require authentication too. Saved results are downloaded
using a standard Authorization header only for the selected Space host; HTTPX
removes that header if a redirect crosses origins. A failed download reuses its
saved result JSON instead of generating another video.

"""Generate flag-only idle loops through the existing authenticated MiniMax worker.
Run: uv run --with gradio_client==2.7.1 python assets/animations/generate-buildings.py
"""
import json
import subprocess
from pathlib import Path
from urllib.parse import urljoin
import httpx
from gradio_client import handle_file
from huggingface_hub import get_token
from space_client import AnimationClient

ROOT = Path(__file__).resolve().parent / 'buildings'
token = get_token()
if not token:
    raise SystemExit('Hugging Face local login required.')
space = 'MiniMaxAI/MiniMax-H3-Turbo-Lora'
client = AnimationClient(space, token=token, download_files=False,
                         headers={'Cache-Control': 'no-cache'}, httpx_kwargs={'timeout': 60})
for kind in ('castle', 'turret'):
    folder = ROOT / kind
    target = folder / 'generated.mp4'
    if target.exists():
        continue
    reference = folder / 'reference.png'
    if not reference.exists():
        subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(folder/'source.png'),
                        '-f', 'lavfi', '-i', 'color=c=magenta:s=544x544', '-filter_complex', '[0:v]scale=440:480:force_original_aspect_ratio=decrease[fg];[1:v][fg]overlay=(W-w)/2:(H-h)/2:format=auto,format=rgb24',
                        '-frames:v', '1', str(reference)], check=True)
    request = dict(space=space, prompt='Only the cloth flag ripples gently in steady wind. Seamless idle loop. Castle, stonework and flagpole completely motionless. Fixed isometric camera, no zoom. Preserve shape, grayscale building and solid magenta background.',
                   canvas='544x544 · 1:1 fast', duration=2, steps=4, seed=42, upsample=False, lora='larry', first_and_last_frame=True)
    (folder/'request.json').write_text(json.dumps(request, indent=2)+'\n')
    saved = folder/'result.json'
    print(f'{kind}: generating flag loop', flush=True)
    if saved.exists():
        result = json.loads(saved.read_text())
    else:
        result = client.generate(in_0=request['prompt'], in_1=handle_file(str(reference)), in_2=handle_file(str(reference)),
                                 in_3=request['canvas'], in_4=2, in_5=4, in_6=42, in_7=False, in_8='larry', api_name='/output_video')
        saved.write_text(json.dumps(result, indent=2, default=str)+'\n')
    video = result[0]
    if isinstance(video, dict):
        video = video.get('url') or video.get('path') or video.get('video',{}).get('url') or video.get('video',{}).get('path')
    if not video.startswith('http'):
        video = urljoin(client.src, video) if video.startswith('/gradio_api/file=') else client.src.rstrip('/')+'/gradio_api/file='+video
    response = httpx.get(video, timeout=120, follow_redirects=True,
                        headers={'Authorization': f'Bearer {token}'} if httpx.URL(video).host == httpx.URL(client.src).host else None)
    response.raise_for_status()
    target.write_bytes(response.content)
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(target), '-vf', 'fps=6,scale=180:180,tile=7x2', '-frames:v', '1', str(folder/'contact-sheet.png')], check=True)
    print(f'{kind}: saved', flush=True)

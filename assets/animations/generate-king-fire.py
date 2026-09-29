"""Generate the King icon's fire loop with the existing authenticated HF pipeline.

uv run --with gradio_client==2.7.1 --with pillow python assets/animations/generate-king-fire.py
"""
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import urljoin

import httpx
from PIL import Image
from gradio_client import handle_file
from huggingface_hub import get_token
from space_client import AnimationClient, recover

ROOT = Path(__file__).resolve().parents[2]
CONTINUOUS = '--continuous' in sys.argv
DIRECTORY = ROOT / ('assets/animations/king/inner-fire-continuous' if CONTINUOUS else 'assets/animations/king/inner-fire')
DIRECTORY.mkdir(parents=True, exist_ok=True)
REFERENCE = DIRECTORY / 'reference.png'
TARGET = DIRECTORY / 'generated.mp4'
SOURCE = ROOT / 'assets/raw/king-head-inner-fire-v2.png'
REQUEST = {
    'space': 'emersoftware/aoa-minimax-animation-worker',
    'original_space': 'MiniMaxAI/MiniMax-H3-Turbo-Lora',
    'prompt': 'Only fire and sparks blast from inside the hood, bottom-left to top-right. Strong continuous flow, all particles stay inside frame. Head, crown, hood and camera perfectly still.',
    'canvas': '544x544 · 1:1 fast',
    'duration': 2, 'steps': 6, 'seed': 42, 'upsample': False, 'lora': 'larry',
    'first_and_last_frame': True,
    'source': str(SOURCE.relative_to(ROOT)),
    'reference': 'reference.png',
    'reference_size': 384, 'reference_offset': [16, 128],
}
if CONTINUOUS:
    REQUEST.update(prompt='Locked still head and camera. Only fire and sparks stream steadily from inside hood toward upper right. Constant strong flow, no buildup or pauses. Particles fade before frame edges.',
                   duration=6, steps=8, first_and_last_frame=False)

def main():
    if TARGET.exists():
        print('Generated clip already exists; no new GPU submission.', flush=True)
        return
    token = get_token()
    if not token:
        raise SystemExit('Authenticate with hf auth login first.')
    request_path = DIRECTORY / 'request.json'
    if request_path.exists():
        request = json.loads(request_path.read_text())
    else:
        request = REQUEST
        request_path.write_text(json.dumps(request, indent=2) + '\n')
    if not REFERENCE.exists():
        size = request['reference_size']
        source = Image.open(SOURCE).convert('RGBA').resize((size, size), Image.Resampling.LANCZOS)
        background = Image.new('RGBA', (544, 544), (0, 0, 0, 255))
        background.alpha_composite(source, tuple(request['reference_offset']))
        background.convert('RGB').save(REFERENCE)
    client = AnimationClient(request['space'], token=token, download_files=False,
                             headers={'Cache-Control': 'no-cache', 'Authorization': f'Bearer {token}'},
                             httpx_kwargs={'timeout': 60})
    result_path = DIRECTORY / 'result.json'
    if result_path.exists():
        result = json.loads(result_path.read_text())
    else:
        print('Submitting King inner-fire animation.', flush=True)
        result = client.generate(
            in_0=request['prompt'], in_1=handle_file(str(REFERENCE)),
            in_2=handle_file(str(REFERENCE)) if request['first_and_last_frame'] else None,
            in_3=request['canvas'], in_4=request['duration'], in_5=request['steps'],
            in_6=request['seed'], in_7=request['upsample'], in_8=request['lora'],
            api_name='/output_video')
        result_path.write_text(json.dumps(result, indent=2, default=str) + '\n')
    video = result[0]
    if isinstance(video, dict):
        video = video.get('url') or video.get('path') or video.get('video', {}).get('url') or video.get('video', {}).get('path')
    if not video.startswith('http'):
        video = urljoin(client.src, video) if video.startswith('/gradio_api/file=') else client.src.rstrip('/') + '/gradio_api/file=' + video
    headers = {'Authorization': f'Bearer {token}'} if httpx.URL(video).host == httpx.URL(client.src).host else None
    def download():
        response = httpx.get(video, timeout=120, follow_redirects=True, headers=headers)
        response.raise_for_status()
        return response.content
    pending = TARGET.with_suffix('.part')
    pending.write_bytes(recover(download, 'download'))
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(pending),
                    '-vf', 'fps=6,scale=216:216,tile=6x2', '-frames:v', '1',
                    str(DIRECTORY / 'contact-sheet.png')], check=True)
    pending.replace(TARGET)
    print(f'Saved {TARGET.relative_to(ROOT)}', flush=True)

if __name__ == '__main__':
    main()

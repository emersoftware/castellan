"""Generate one-shot collapses using the existing local HF login and recovery client.
Prepare with node packages/web/scripts/building-collapse.mjs --prepare first.
Run: uv run --with gradio_client==2.7.1 python assets/animations/generate-building-collapse.py
"""
import argparse
import json
import subprocess
from pathlib import Path
from urllib.parse import urljoin
import httpx
from gradio_client import handle_file
from huggingface_hub import get_token
from space_client import AnimationClient, recover

ROOT = Path(__file__).resolve().parent / 'buildings' / 'collapse'
KINDS = ('wall', 'wallpost', 'door', 'door-open', 'turret', 'castle')
SUBJECTS = {'wall': 'stone wall', 'wallpost': 'stone wall pillar', 'door': 'stone gate and metal portcullis',
            'door-open': 'stone gate with raised metal portcullis', 'turret': 'stone defensive tower with flag',
            'castle': 'stone castle with flag'}

def main(options):
    token = get_token()
    if not token:
        raise SystemExit('Hugging Face local login required.')
    client = AnimationClient(options.space, token=token, download_files=False,
        headers={'Cache-Control': 'no-cache'}, httpx_kwargs={'timeout': 60})
    for kind in ([options.kind] if options.kind else KINDS):
        folder = ROOT / kind
        target = folder / 'generated.mp4'
        if target.exists():
            print(f'{kind}: completed clip exists', flush=True)
            continue
        reference = folder / 'reference.png'
        request = dict(space=options.space, kind=kind, action='death',
            prompt=f'The {SUBJECTS[kind]} crumbles and collapses downward into a low pile of broken stone rubble. Debris settles, motion stops. Fixed isometric camera. Preserve grayscale style and solid magenta background. No explosion, fire or new objects.',
            canvas='544x544 · 1:1 fast', duration=2, steps=6, seed=42, upsample=False, lora='larry',
            reference='reference.png', first_and_last_frame=False)
        path = folder / 'request.json'
        if path.exists():
            request = json.loads(path.read_text())
        request['space'] = options.space
        path.write_text(json.dumps(request, indent=2) + '\n')
        saved = folder / 'result.json'
        if saved.exists():
            result = json.loads(saved.read_text())
        else:
            print(f'{kind}: submitting collapse', flush=True)
            result = client.generate(in_0=request['prompt'], in_1=handle_file(str(reference)), in_2=None,
                in_3=request['canvas'], in_4=request['duration'], in_5=request['steps'], in_6=request['seed'],
                in_7=request['upsample'], in_8=request['lora'], api_name='/output_video')
            saved.write_text(json.dumps(result, indent=2, default=str) + '\n')
        video = result[0]
        if isinstance(video, dict):
            video = video.get('url') or video.get('path') or video.get('video', {}).get('url') or video.get('video', {}).get('path')
        if not video.startswith('http'):
            video = urljoin(client.src, video) if video.startswith('/gradio_api/file=') else client.src.rstrip('/') + '/gradio_api/file=' + video
        def download():
            response = httpx.get(video, timeout=120, follow_redirects=True,
                headers={'Authorization': f'Bearer {token}'} if httpx.URL(video).host == httpx.URL(client.src).host else None)
            response.raise_for_status()
            pending = target.with_suffix('.part')
            pending.write_bytes(response.content)
            subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(pending),
                '-vf', 'fps=6,scale=180:180,tile=7x2', '-frames:v', '1', str(folder / 'contact-sheet.png')], check=True)
            pending.replace(target)
        recover(download, 'download')
        print(f'{kind}: original video saved', flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind', nargs='?', choices=KINDS)
    parser.add_argument('--space', default='MiniMaxAI/MiniMax-H3-Turbo-Lora')
    main(parser.parse_args())

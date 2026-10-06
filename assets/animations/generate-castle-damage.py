"""Generate fire loops and matching falls for exactly the two approved castle states.
uv run --with gradio_client==2.7.1 python assets/animations/generate-castle-damage.py
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

ROOT = Path(__file__).resolve().parent / 'buildings/castle/damage-stages'

def main(options):
    token = get_token()
    if not token:
        raise SystemExit('Local Hugging Face login required.')
    client = AnimationClient(options.space, token=token, download_files=False,
        headers={'Cache-Control': 'no-cache'}, httpx_kwargs={'timeout': 60})
    for action in ('fire', 'death'):
        for stage in ((25, 50) if action=='fire' else ('healthy', 25, 50)):
            folder = ROOT / f'{action}-{stage}'
            target = folder / 'generated.mp4'
            if target.exists():
                print(f'{action}-{stage}: completed video exists', flush=True)
                continue
            request = dict(space=options.space, destructionPercent=0 if stage=='healthy' else stage, action=action,
                prompt=('Only the existing fires flicker and burn continuously. Small sparks rise and fade, smoke drifts upward. Seamless loop. All stonework and camera perfectly motionless. Preserve castle shape, orange flames and solid magenta background.' if action == 'fire' else
                        'Locked isometric game sprite camera. TOP TO BOTTOM structural collapse, one floor at a time. Upper battlements break into individual stone blocks and DROP STRAIGHT DOWN into the central courtyard first. Next upper towers crumble downward and inner walls tip INWARD toward the center. Finally lower walls break inward and drop onto the same foundation. All stones fall DOWN and INWARD, staying inside the original base footprint. Rigid blocks break apart; the castle does not squash, stretch or flatten elastically. No outward push, spreading wall slabs, explosion or flying debris. End exactly on the last reference: low asymmetric architectural ruins, broken short perimeter walls and corner bases, loose small masonry blocks resting flat in the courtyard. The final ruins have open spaces and retain the original foundation footprint. No tall mound or pyramid-shaped heap. Fixed camera and ground position, solid magenta background throughout. Small fires go out as stone blocks fall. Only this single castle.'),
                canvas='544x544 · 1:1 fast', duration=2, steps=6 if action=='fire' else 10, seed=42 if action=='fire' else 93, upsample=False,
                lora='larry', first_and_last_frame=True, reference='reference.png',
                last_reference='reference.png' if action=='fire' else 'last-reference.png')
            path = folder / 'request.json'
            if path.exists():
                request = json.loads(path.read_text())
            path.write_text(json.dumps(request, indent=2) + '\n')
            saved = folder / 'result.json'
            if saved.exists():
                result = json.loads(saved.read_text())
            else:
                print(f'{action}-{stage}: submitting', flush=True)
                result = client.generate(in_0=request['prompt'], in_1=handle_file(str(folder/'reference.png')),
                    in_2=handle_file(str(folder/request.get('last_reference','reference.png'))) if request['first_and_last_frame'] else None,
                    in_3=request['canvas'], in_4=request['duration'], in_5=request['steps'], in_6=request['seed'],
                    in_7=request['upsample'], in_8=request['lora'], api_name='/output_video')
                saved.write_text(json.dumps(result, indent=2, default=str) + '\n')
            video = result[0]
            if isinstance(video, dict):
                video = video.get('url') or video.get('path') or video.get('video', {}).get('url') or video.get('video', {}).get('path')
            if not video.startswith('http'):
                video = urljoin(client.src, video) if video.startswith('/gradio_api/file=') else client.src.rstrip('/')+'/gradio_api/file='+video
            def download():
                response = httpx.get(video, timeout=120, follow_redirects=True,
                    headers={'Authorization': f'Bearer {token}'} if httpx.URL(video).host == httpx.URL(client.src).host else None)
                response.raise_for_status()
                pending = target.with_suffix('.part')
                pending.write_bytes(response.content)
                subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(pending),
                    '-vf', 'fps=6,scale=180:180,tile=7x2', '-frames:v', '1', str(folder/'contact-sheet.png')], check=True)
                pending.replace(target)
            recover(download, 'download')
            print(f'{action}-{stage}: original video saved', flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--space', default='MiniMaxAI/MiniMax-H3-Turbo-Lora')
    main(parser.parse_args())

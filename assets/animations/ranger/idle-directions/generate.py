"""Resumable MiniMax generation. Run with uv run --with gradio_client python FILE [DIRECTION]."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time
from gradio_client import Client, handle_file
from huggingface_hub import get_token

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
PROMPT = ('Seamless idle loop, gentle breathing and subtle cloak sway. '
          'Feet planted, bow steady. Fixed isometric camera. '
          'Preserve character, facing and magenta background.')
VIEWS = {'s': 0, 'se': 1, 'e': 2, 'ne': 3, 'n': 4}

def ffmpeg(*args):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', *map(str,args)], check=True)

def main():
    stage = 'idle'
    selected = [sys.argv[1]] if len(sys.argv)>1 else list(VIEWS)
    token = get_token()
    if not token: raise SystemExit('Authenticate with hf auth login first.')
    client = Client('MiniMaxAI/MiniMax-H3-Turbo-Lora', token=token,
                    download_files=str(HERE/'downloads'), httpx_kwargs={'timeout': 60})
    for direction in selected:
        view = VIEWS[direction]
        directory = HERE/direction
        directory.mkdir(parents=True, exist_ok=True)
        target = directory/'generated.mp4'
        if target.exists():
            print(f'{direction}/{stage}: already generated',flush=True)
            continue
        reference = directory/'reference.png'
        if not reference.exists():
            ffmpeg('-i', ROOT/'assets/raw/ranger_sheet.png', '-vf',
                   f'crop=290:400:{45+view*290}:535,pad=400:400:55:0:color=magenta,scale=544:544',
                   '-frames:v',1,reference)
        request = dict(space='MiniMaxAI/MiniMax-H3-Turbo-Lora',direction=direction,
                       stage=stage,prompt=PROMPT,canvas='544x544 · 1:1 fast',
                       duration=2,steps=4,seed=42,upsample=False,lora='larry',
                       reference='reference.png',first_and_last_frame=True,
                       source='assets/raw/ranger_sheet.png', source_view=view)
        (directory/'request.json').write_text(json.dumps(request,indent=2,ensure_ascii=False)+'\n')
        print(f'{direction}/{stage}: submitting',flush=True)
        job = client.submit(in_0=PROMPT,in_1=handle_file(str(reference)),in_2=handle_file(str(reference)),
                            in_3=request['canvas'],in_4=2,in_5=4,in_6=42,in_7=False,in_8='larry',
                            api_name='/output_video')
        previous=None
        while not job.done():
            status=job.status()
            if str(status.code)!=previous:
                previous=str(status.code)
                print(f'{direction}/{stage}: {previous}',flush=True)
            time.sleep(5)
        result=job.result()
        (directory/'result.json').write_text(json.dumps(result,indent=2,default=str)+'\n')
        video=result[0]
        if isinstance(video,dict):video=video.get('path') or video.get('video',{}).get('path')
        shutil.copy2(video,target)
        ffmpeg('-i',target,'-vf','fps=6,scale=180:180,tile=7x2','-frames:v',1,directory/'contact-sheet.png')
        print(f'{direction}/{stage}: saved. {result[1]}',flush=True)

if __name__=='__main__':main()

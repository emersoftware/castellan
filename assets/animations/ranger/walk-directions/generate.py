"""Resumable MiniMax generation. Run with uv run --with gradio_client python FILE bootstrap|continuous [DIRECTION]."""
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
PROMPT = ('Seamless walk cycle in place, constant pace from first to last frame, '
          'no pauses or easing. Fixed isometric camera. '
          'Preserve character, facing, bow and magenta background.')
VIEWS = {'s': 0, 'se': 1, 'ne': 3, 'n': 4}

def ffmpeg(*args):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', *map(str,args)], check=True)

def main():
    stage = sys.argv[1]
    assert stage in ('bootstrap', 'continuous')
    selected = [sys.argv[2]] if len(sys.argv)>2 else list(VIEWS)
    token = get_token()
    if not token: raise SystemExit('Authenticate with hf auth login first.')
    client = Client('MiniMaxAI/MiniMax-H3-Turbo-Lora', token=token,
                    download_files=str(HERE/'downloads'))
    for direction in selected:
        view = VIEWS[direction]
        directory = HERE/direction/stage
        directory.mkdir(parents=True, exist_ok=True)
        target = directory/'generated.mp4'
        if target.exists():
            print(f'{direction}/{stage}: already generated',flush=True)
            continue
        reference = directory/'reference.png'
        if not reference.exists():
            if stage == 'bootstrap':
                ffmpeg('-i', ROOT/'assets/raw/ranger_sheet.png', '-vf',
                       f'crop=290:400:{45+view*290}:535,pad=400:400:55:0:color=magenta,scale=544:544',
                       '-frames:v',1,reference)
            else:
                ffmpeg('-i', HERE/direction/'bootstrap/generated.mp4','-vf',
                       'select=eq(n\\,12)','-frames:v',1,reference)
        request = dict(space='MiniMaxAI/MiniMax-H3-Turbo-Lora',direction=direction,
                       stage=stage,prompt=PROMPT,canvas='544x544 · 1:1 fast',
                       duration=2,steps=4,seed=42,upsample=False,lora='larry',
                       reference='reference.png',first_and_last_frame=True,
                       source='assets/raw/ranger_sheet.png' if stage=='bootstrap' else f'../bootstrap/generated.mp4',
                       source_view=view if stage=='bootstrap' else None,
                       source_frame=12 if stage=='continuous' else None)
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

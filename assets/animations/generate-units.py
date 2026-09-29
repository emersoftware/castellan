"""Generate unit clips with the same authenticated MiniMax pipeline as Ranger.
Run: uv run --with gradio_client==2.7.1 python assets/animations/generate-units.py [king|knight|ranger|worker]
Resumes completed clips. Credentials stay in the local Hugging Face login.
"""
import argparse
import json
from pathlib import Path
from urllib.parse import urljoin
import subprocess
import time
import httpx
from gradio_client import handle_file
from huggingface_hub import get_token
from space_client import AnimationClient

ROOT = Path(__file__).resolve().parents[2]
VIEWS = {'s':0, 'se':1, 'e':2, 'ne':3, 'n':4}
FACING = {'s':'toward camera', 'se':'toward lower right', 'e':'to the right', 'ne':'diagonally away to the right', 'n':'away from camera'}
def ff(*args):
    subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error',*map(str,args)],check=True)
def main(options):
    token=get_token()
    if not token: raise SystemExit('Authenticate with hf auth login first.')
    client=AnimationClient(options.space,token=token,
                  download_files=False,headers={'Cache-Control':'no-cache'},httpx_kwargs={'timeout':60})
    kinds=[options.kind] if options.kind else ['knight','king']
    completed=0
    for kind in kinds:
        assert kind in ('king','knight','ranger','worker')
        equipment={'knight':'sword and shield','king':'crown, cloak and scepter','ranger':'bow and quiver','worker':'pickaxe'}[kind]
        actions=[options.action] if options.action else (['walk','mine','attack','death'] if kind=='worker' else ['death'] if kind=='ranger' else ['idle','walk']+(['attack'] if kind=='knight' else []))
        for action in actions:
            if options.action and options.action != action: continue
            for stage in (['bootstrap','continuous'] if action=='walk' else [action]):
                if options.stage and options.stage != stage: continue
                for direction,view in VIEWS.items():
                    if options.direction and options.direction != direction: continue
                    directory=ROOT/f'assets/animations/{kind}/{action}-directions'/direction
                    if action=='walk': directory/=stage
                    directory.mkdir(parents=True,exist_ok=True)
                    target=directory/'generated.mp4'
                    if target.exists():
                        print(f'{kind}/{action}/{direction}/{stage}: exists',flush=True);continue
                    if action=='idle': prompt=f'Seamless idle loop, gentle breathing and subtle cloth sway. Feet planted, {equipment} steady. Fixed isometric camera. Preserve character, facing and magenta background.'
                    elif action=='walk': prompt=f'Seamless walk cycle in place, constant pace, no pauses or easing. Fixed isometric camera. Preserve character, facing, {equipment} and magenta background.'
                    elif action=='death': prompt=f'Falls onto his side, lying dead and still. Static isometric view. Preserve character and {equipment}. Solid magenta background stays unchanged.'
                    elif action=='mine': prompt='Repeated overhead pickaxe swings down into empty air. Feet planted. Fixed isometric camera. Preserve character, facing and solid magenta background.'
                    elif kind=='knight': prompt=f'One sword slash {FACING[direction]}, then return to idle. Shield stays in other hand. Feet planted, fixed isometric camera. Preserve armor, facing and magenta background. No effects.'
                    elif kind=='king': prompt=('Swings his scepter overhead then down away from camera. Back stays facing camera. Feet planted. Preserve character and weapon. Fixed isometric view, plain magenta background.' if direction=='n' else f'One forceful forward jab with his staff {FACING[direction]}, then idle. Feet planted. Same character, facing, isometric view and plain magenta background.')
                    else: prompt=f'One {"pickaxe" if kind=="worker" else "scepter"} strike {FACING[direction]}, then return to idle. Feet planted, fixed isometric camera. Preserve character, facing, equipment and magenta background. No effects.'
                    reference=directory/'reference.png'
                    if not reference.exists():
                        if stage=='continuous':
                            ff('-i',directory.parent/'bootstrap/generated.mp4','-vf','select=eq(n\\,12)','-frames:v',1,reference)
                        else:
                            vf=f'crop=290:400:{45+view*290}:535,pad=400:400:55:0:color=magenta,scale=544:544'
                            if action=='attack' and kind!='king': vf+=',pad=544:574:0:30:color=magenta,crop=544:544:0:0'
                            settings_path=directory.parent/'export-settings.json'
                            export_settings=json.loads(settings_path.read_text()) if settings_path.exists() else {}
                            scale=export_settings.get('referenceScale',{}).get(direction,1)
                            if scale!=1:
                                size=round(544*scale);pad=(544-size)//2
                                vf+=f',scale={size}:{size},pad=544:544:{pad}:{pad}:color=magenta'
                            ff('-i',ROOT/f'assets/raw/{kind}_sheet.png','-vf',vf,'-frames:v',1,reference)
                    request=dict(space='MiniMaxAI/MiniMax-H3-Turbo-Lora',kind=kind,action=action,stage=stage,direction=direction,
                                 prompt=prompt,canvas='544x544 · 1:1 fast',duration=2,steps=8 if kind=='king' and action=='attack' and direction=='n' else 6 if action=='death' or action=='attack' and kind in ('worker','king') else 4,seed=42,upsample=False,lora='larry',
                                 reference='reference.png',first_and_last_frame=action!='death',source=f'assets/raw/{kind}_sheet.png',source_view=view)
                    rp=directory/'request.json'
                    if rp.exists(): request=json.loads(rp.read_text())
                    request['space']=options.space
                    rp.write_text(json.dumps(request,indent=2)+'\n')
                    if (directory/'result.json').exists():
                        print(f'{kind}/{action}/{direction}/{stage}: downloading saved result',flush=True)
                        result=json.loads((directory/'result.json').read_text())
                    else:
                        print(f'{kind}/{action}/{direction}/{stage}: submitting',flush=True)
                        result=client.generate(in_0=request['prompt'],in_1=handle_file(str(reference)),in_2=handle_file(str(reference)) if request['first_and_last_frame'] else None,
                                          in_3=request['canvas'],in_4=request['duration'],in_5=request['steps'],in_6=request['seed'],
                                          in_7=request['upsample'],in_8=request['lora'],api_name='/output_video')
                        (directory/'result.json').write_text(json.dumps(result,indent=2,default=str)+'\n')
                    video=result[0]
                    if isinstance(video,dict): video=video.get('url') or video.get('path') or video.get('video',{}).get('url') or video.get('video',{}).get('path')
                    if not video.startswith('http'):
                        video=urljoin(client.src,video) if video.startswith('/gradio_api/file=') else client.src.rstrip('/')+'/gradio_api/file='+video
                    same_space=httpx.URL(video).host==httpx.URL(client.src).host
                    for attempt in range(4):
                        try:
                            response=httpx.get(video,timeout=120,follow_redirects=True,
                                               headers={'Authorization':f'Bearer {token}'} if same_space else None)
                            response.raise_for_status()
                            pending=target.with_suffix('.part')
                            pending.write_bytes(response.content)
                            contact_fps=3 if request['duration']>3 else 6
                            ff('-i',pending,'-vf',f'fps={contact_fps},scale=180:180,tile=7x2','-frames:v',1,directory/'contact-sheet.png')
                            pending.replace(target)
                            break
                        except httpx.HTTPError:
                            if attempt==3: raise
                            time.sleep(3)
                    print(f'{kind}/{action}/{direction}/{stage}: saved',flush=True)
                    completed+=1
                    if options.limit and completed>=options.limit: return
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kind',nargs='?',choices=['king','knight','ranger','worker'])
    parser.add_argument('--action',choices=['idle','walk','attack','death','mine'])
    parser.add_argument('--direction',choices=list(VIEWS))
    parser.add_argument('--stage',choices=['bootstrap','continuous','idle','attack','death','mine'])
    parser.add_argument('--limit',type=int,default=0)
    parser.add_argument('--space',default='MiniMaxAI/MiniMax-H3-Turbo-Lora')
    options=parser.parse_args()
    main(options)

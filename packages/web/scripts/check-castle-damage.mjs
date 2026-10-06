/** Actual Pixi QA and preview of the two selected states, mapped fire and inward falls. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

const output=new URL('../../../assets/animations/buildings/castle/damage-stages/review/',import.meta.url).pathname;
await mkdir(output,{recursive:true});
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,
  args:['--enable-unsafe-swiftshader','--use-angle=swiftshader'],defaultViewport:{width:1440,height:900}});
try {
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.AOA_WEB_URL??'http://127.0.0.1:5174',{waitUntil:'networkidle0'});
  const rulesModule=`/@fs/${new URL('../../../packages/shared/src/rules.ts',import.meta.url).pathname}`;
  await page.evaluate(async rulesModule=>{
    const {GameRenderer}=await import('/src/render/renderer.ts');const {rules}=await import(rulesModule);
    const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;background:black;z-index:100';document.body.append(host);
    const label=document.createElement('div');label.style.cssText='position:fixed;left:30px;top:22px;color:#eee;font:22px monospace;z-index:101';
    label.textContent='DAÑO LEVE / INTERMEDIO · FUEGO + PARTÍCULAS';document.body.append(label);
    const renderer=await GameRenderer.create(host,{...rules,map:{...rules.map,width:24,height:24,walls:[],deposits:[],sharedDeposits:[]}},{a:0,b:1,c:2,d:3},{interactive:false});
    const clock=renderer.manualClock();renderer.zoom(1.25);
    const entities=[25,50].flatMap((stage,row)=>['a','b','c','d'].map((owner,col)=>({id:`${stage}-${col}`,kind:'castle',owner,
      x:6+row*4+col*3,y:15+row*4-col*3,hp:stage===25?50:25,maxHp:100})));
    const frame=(tick,alive=true,hp)=>({tick,timeMs:tick*100,entities:alive?entities.map(e=>({...e,hp:hp??e.hp})):[],deposits:[],events:[],projectiles:[],status:'running'});
    clock.setTime(0);renderer.setFrame(frame(1),100);clock.draw();
    const drawn=entities.map(e=>renderer.drawn.get(e.id));
    window.damageReview={renderer,clock,drawn,frame,label,step(ms){clock.setTime(ms);clock.draw();},live(tick){renderer.setFrame(frame(tick),100);clock.draw();},
      die(){renderer.setFrame({...frame(40,false),events:entities.map(e=>({tick:39,type:'death',id:e.id,kind:e.kind,owner:e.owner,x:e.x,y:e.y}))},100);label.textContent='CAÍDA DE ARRIBA HACIA ABAJO · PAREDES HACIA ADENTRO';clock.draw();},
      cells(){return drawn.map(d=>({destroyed:d.sprite.destroyed,body:d.sprite.destroyed?null:{x:d.sprite.texture.frame.x,y:d.sprite.texture.frame.y},
        flame:d.flame?{x:d.flame.texture.frame.x,y:d.flame.texture.frame.y,tint:d.flame.tint}:null,particles:!!d.sparks}));}};
  },rulesModule);
  const initial=await page.evaluate(()=>window.damageReview.cells());
  assert.ok(initial.every(c=>c.flame?.tint===0xff8000&&c.particles));
  await page.screenshot({path:`${output}/fire.png`});
  // Test the actual shader output over the blue castle, where gray flame tones
  // cannot come from owner masonry. Flames and sparks share ordered dithering.
  const pixels=await sharp(`${output}/fire.png`).extract({left:335,top:285,width:140,height:175}).removeAlpha().raw().toBuffer();
  const fireCounts=new Map([['30,30,30',0],['164,164,164',0],['255,255,255',0]]);
  for(let i=0;i<pixels.length;i+=3) {
    const key=`${pixels[i]},${pixels[i+1]},${pixels[i+2]}`;
    if(fireCounts.has(key))fireCounts.set(key,fireCounts.get(key)+1);
  }
  assert.ok([...fireCounts.values()].every(n=>n>0),`Missing shader fire ramp tones: ${JSON.stringify([...fireCounts])}`);
  await page.evaluate(()=>{window.damageReview.step(100);window.damageReview.live(2);});
  const moving=await page.evaluate(()=>window.damageReview.cells());
  assert.notDeepEqual(moving.map(c=>c.flame),initial.map(c=>c.flame));
  assert.deepEqual(moving.map(c=>c.body),initial.map(c=>c.body));
  await page.evaluate(()=>window.damageReview.renderer.setPaused(true));
  const paused=await page.screenshot();
  await page.evaluate(()=>window.damageReview.step(9000));
  assert.deepEqual(await page.screenshot(),paused);
  await page.evaluate(()=>{window.damageReview.renderer.setPaused(false);window.damageReview.renderer.setFrame(window.damageReview.frame(3,true,100),100,true);window.damageReview.step(9100);});
  assert.ok((await page.evaluate(()=>window.damageReview.cells())).every(c=>!c.flame&&!c.particles));
  await page.evaluate(()=>{window.damageReview.renderer.setFrame(window.damageReview.frame(1),100,true);window.damageReview.step(9200);});
  if(process.argv.includes('--record')) {
    await mkdir(`${output}/movie-frames`,{recursive:true});
    for(let n=0;n<126;n++) {
      await page.evaluate(({n,ms})=>{const r=window.damageReview;r.clock.setTime(ms);if(n<36)r.live(n+2);else if(n===36)r.die();r.clock.draw();},{n,ms:9200+n*1000/12});
      if(n===37)assert.ok(await page.evaluate(()=>window.damageReview.drawn.every(d=>
        d.collapseLayer&&!d.collapseLayer.mask&&d.sprite.parent===d.collapseLayer&&d.flame?.parent===d.collapseLayer&&d.sparks?.parent===d.collapseLayer)),
        'The collapse must remain unmasked and fade in place');
      await page.screenshot({path:`${output}/movie-frames/${String(n).padStart(3,'0')}.png`});
      if(n===48||n===63||n===76)await page.screenshot({path:`${output}/${n===48?'upper-fall':n===63?'inward-fall':'rubble'}.png`});
    }
    execFileSync('ffmpeg',['-y','-hide_banner','-loglevel','error','-framerate','12','-i',`${output}/movie-frames/%03d.png`,'-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',`${output}/in-game-fire-and-inward-collapse.mp4`]);
    execFileSync('ffmpeg',['-y','-hide_banner','-loglevel','error','-i',`${output}/in-game-fire-and-inward-collapse.mp4`,'-filter_complex','fps=12,scale=960:-1,split[a][b];[a]palettegen[p];[b][p]paletteuse',`${output}/in-game-fire-and-inward-collapse.gif`]);
    assert.ok((await page.evaluate(()=>window.damageReview.cells())).every(c=>c.destroyed&&!c.flame&&!c.particles));
  }
  assert.deepEqual(errors,[]);
  console.log(`Pixi QA passed: two stages, four owner colors, fixed masonry, animated fire, particles, pause, heal/seek and collapse cleanup. ${output}`);
}finally{
  const shutdown=setTimeout(()=>browser.process()?.kill('SIGKILL'),5000);
  try{await browser.close();}finally{clearTimeout(shutdown);}
}

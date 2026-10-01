// Visual/runtime QA for the Worker idle. Requires the local web dev server.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader'],defaultViewport:{width:1200,height:800}});
try {
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:5173',{waitUntil:'networkidle0'});
 await page.waitForSelector('.landing:not(.pending)');
 await page.evaluate(()=>document.querySelector('.units').scrollIntoView());
 await new Promise(r=>setTimeout(r,500));
 const portrait=()=>page.$eval('.unit:nth-child(2) canvas',c=>c.toDataURL());
 const first=await portrait(); await new Promise(r=>setTimeout(r,750));
 assert.notEqual(await portrait(),first,'Worker portrait must animate');
 await page.screenshot({path:'/tmp/aoa-worker-idle-landing.png'});
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 await new Promise(r=>setTimeout(r,200));const still=await portrait();
 await new Promise(r=>setTimeout(r,300));assert.equal(await portrait(),still);
 await page.evaluate(async()=>{
   const {GameRenderer}=await import(performance.getEntriesByType('resource').map(e=>e.name).find(u=>u.includes('/src/render/renderer.ts')));
   const {ruleset}=await fetch('/featured/ef3532ef.json').then(r=>r.json());
   const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;background:black;z-index:100';document.body.append(host);
   const renderer=await GameRenderer.create(host,{...ruleset,map:{...ruleset.map,width:16,height:16,walls:[]}},{a:0,b:1,c:2,d:3},{interactive:false});
   const clock=renderer.manualClock();
   const entities=Array.from({length:8},(_,i)=>({id:`w${i}`,kind:'worker',owner:['a','b','c','d'][i%4],x:4+(i%4)*2,y:5+Math.floor(i/4)*4,hp:50,maxHp:50}));
   const frame=t=>({tick:t,timeMs:t*100,entities,deposits:[],events:[],projectiles:[],status:'running'});
   renderer.setFrame(frame(1),100);
   for(let i=0;i<8;i++) renderer.drawn.get(`w${i}`).dir=i;
   clock.draw();
   window.workerPreview={renderer,clock,frame,step(t){clock.setTime(t*100);renderer.setFrame(frame(t),100);clock.draw();}};
 });
 await page.evaluate(()=>window.workerPreview.step(6));
 await page.screenshot({path:'/tmp/aoa-worker-idle-directions.png'});
 const cells=await page.evaluate(()=>[...window.workerPreview.renderer.drawn.values()].map(d=>({frame:d.sprite.texture.frame.x,row:d.sprite.texture.frame.y,flip:d.sprite.scale.x<0})));
 assert.ok(cells.every(c=>c.frame>0)); assert.deepEqual(cells.map(c=>c.row),[0,112,224,336,448,336,224,112]);
 assert.deepEqual(cells.map(c=>c.flip),[false,false,false,false,false,true,true,true]);
 await page.evaluate(()=>window.workerPreview.renderer.setPaused(true));
 const frozen=await page.evaluate(()=>window.workerPreview.renderer.drawn.get('w0').sprite.texture.frame.x);
 await page.evaluate(()=>{window.workerPreview.clock.setTime(9999);window.workerPreview.clock.draw();});
 assert.equal(await page.evaluate(()=>window.workerPreview.renderer.drawn.get('w0').sprite.texture.frame.x),frozen);
 assert.deepEqual(errors,[]);
 console.log('Worker idle verified: moving landing portrait, reduced motion, eight game directions, mirrored west views, game pause, no browser errors.');
} finally {await browser.close();}

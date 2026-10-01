// Runtime visual check with current rules (old v0 replays do not define doors).
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const sharedPath=new URL('../../shared/src/index.ts',import.meta.url).pathname;
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader'],defaultViewport:{width:1200,height:800}});
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:5173',{waitUntil:'networkidle0'});await page.waitForSelector('.landing:not(.pending)');
 await page.evaluate(()=>document.querySelector('.units').scrollIntoView());await new Promise(r=>setTimeout(r,600));
 await page.screenshot({path:'/tmp/aoa-door-landing.png'});
 await page.evaluate(async(sharedPath)=>{
 const {GameRenderer}=await import(performance.getEntriesByType('resource').map(e=>e.name).find(u=>u.includes('/src/render/renderer.ts')));
 const {v15:ruleset}=await import('/@fs'+sharedPath);
 const host=document.createElement('div');host.style.cssText='position:fixed;inset:0;background:black;z-index:100';document.body.append(host);
 const r=await GameRenderer.create(host,{...ruleset,map:{...ruleset.map,width:12,height:12,walls:[]}},{a:0,b:1,c:2,d:3},{interactive:false});
 const clock=r.manualClock();r.zoom(1.5);
 const entities=[];
 for(let row=0;row<4;row++)for(let i=0;i<5;i++)entities.push({id:`${row}:${i}`,kind:i===2?'door':'wall',owner:['a','b','c','d'][row],x:row<2?2+row*3:i+6,y:row<2?i+2:3+(row-2)*4,hp:150,maxHp:150,open:row%2===1});
 r.setFrame({tick:1,timeMs:100,entities,deposits:[],events:[],projectiles:[],status:'running'},100);clock.draw();
 window.doorPreview={r,clock,entities};
 },sharedPath);
 await new Promise(r=>setTimeout(r,400));await page.screenshot({path:'/tmp/aoa-door-walls.png'});
 await page.evaluate(()=>{const {r,clock,entities}=window.doorPreview;entities.forEach(e=>{if(e.kind==='door')e.open=!e.open;});r.setFrame({tick:2,timeMs:200,entities,deposits:[],events:[],projectiles:[],status:'running'},100);clock.draw();});
 await page.screenshot({path:'/tmp/aoa-door-walls-toggled.png'});
 assert.deepEqual(errors,[]);console.log('Current rules: both axes, all four colours, closed/open; no browser errors.');
} finally {await browser.close();}

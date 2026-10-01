// Local browser QA. Run with the web/server dev processes already up.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader'],defaultViewport:{width:1440,height:1000}});
try {
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:5173',{waitUntil:'networkidle0'});
 await page.waitForSelector('.landing:not(.pending)',{timeout:60000});
 await page.click('h1');
 await new Promise(r=>setTimeout(r,2000));
 const audio=()=>page.evaluate(async()=>{const url=performance.getEntriesByType('resource').map(e=>e.name).find(u=>u.includes('/src/audio/sfx.ts'));const {sfx}=await import(url);return {effects:sfx.effectsMuted,music:sfx.musicMuted,track:sfx.music?.track,gain:sfx.music?.gain.gain.value};});
 assert.equal((await audio()).track,'theme');
 const initialY=await page.$eval('.page-sound',e=>e.getBoundingClientRect().y);
 await page.evaluate(()=>document.querySelector('.units').scrollIntoView());
 await new Promise(r=>setTimeout(r,1500));
 assert.equal(await page.$eval('.page-sound',e=>e.getBoundingClientRect().y),initialY);
 assert.equal(await page.$eval('.unit-grid',e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),4);
 const colors=()=>page.$$eval('.unit canvas',canvases=>canvases.map(c=>{const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;const counts={};for(let i=0;i<data.length;i+=4){if(data[i+3] && data[i]+data[i+1]+data[i+2]>0){const rgb=[...data.slice(i,i+3)].join(',');counts[rgb]=(counts[rgb]??0)+1;}}return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0];}));
 const before=await colors();
 assert.equal(new Set(before).size,4);
 await page.hover('.unit');await new Promise(r=>setTimeout(r,200));
 assert.notEqual((await colors())[0],before[0]);
 await page.screenshot({path:'/tmp/aoa-landing-armies.png'});
 await page.click('.sound:first-child');
 assert.deepEqual({...await audio(),gain:undefined},{effects:true,music:false,track:'theme',gain:undefined});
 await page.click('.sound:last-child');await page.click('.sound:first-child');
 assert.equal((await audio()).effects,false);assert.equal((await audio()).music,true);
 await page.reload({waitUntil:'networkidle0'});
 assert.equal((await audio()).effects,false);assert.equal((await audio()).music,true);
 await page.click('.sound:last-child');
 await page.goto('http://localhost:5173/replay/ef3532ef',{waitUntil:'networkidle0'});
 await page.click('.controls .sound:last-child'); // off
 await page.click('.controls .sound:last-child'); // on + gesture unlock
 await new Promise(r=>setTimeout(r,2200));
 const battle=await audio(); assert.equal(battle.track,'battle');assert.ok(Math.abs(battle.gain-0.09)<0.001);
 await page.screenshot({path:'/tmp/aoa-battle-buildings.png'});
 await page.setViewport({width:390,height:844});
 await page.screenshot({path:'/tmp/aoa-battle-mobile.png'});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.goto('http://localhost:5173',{waitUntil:'networkidle0'});
 await page.evaluate(()=>document.querySelector('.units').scrollIntoView());
 await new Promise(r=>setTimeout(r,1500));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'/tmp/aoa-landing-mobile.png'});
 assert.deepEqual(errors,[]);
 console.log('Verified: four columns / four colors / hover cycle / fixed audio / independent mute / persistence / theme-to-battle switch / battle gain 0.09 / mobile overflow / no page errors.');
} finally {await browser.close();}

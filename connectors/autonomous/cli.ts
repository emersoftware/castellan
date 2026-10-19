#!/usr/bin/env -S pnpm exec tsx
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { client } from '../cli/src/client';
import { httpTransport, runPlayer } from './src/runtime';


const {values}=parseArgs({options:{server:{type:'string'},out:{type:'string'},practice:{type:'string'},map:{type:'string'},poll:{type:'string'},help:{type:'boolean'}}});
if(values.help){
  console.log(`Autonomous Castellan player
CASTELLAN_TOKEN=... pnpm exec tsx connectors/autonomous/cli.ts --out /tmp/castellan-player
pnpm exec tsx connectors/autonomous/cli.ts --practice eco --map open --out /tmp/castellan-practice
Options: --server URL --practice BOT --map MAP --poll 1000
All decisions run locally inside the player. No model login is required.
Use a different --out per match/player. Reusing it resumes that player's checkpoint.`);
  process.exit(0);
}
const poll=Number(values.poll??1000);
if(!Number.isFinite(poll)||poll<200||poll>10000)throw new Error('--poll must be 200..10000 milliseconds');
const server=values.server??process.env.CASTELLAN_SERVER??'http://localhost:4400';
let token=process.env.CASTELLAN_TOKEN;
if(values.practice){
  // Lobby setup only. Only the selected player's capability reaches the runtime.
  const lobby=client({server}),map=values.map??'open';
  const maps=await lobby.get<{name:string;players:number}[]>('/maps');
  const seats=maps.find(m=>m.name===map)?.players;
  if(!seats)throw new Error(`Unknown map ${map}`);
  const players=Array.from({length:seats},(_,i)=>i===0?{name:'Autonomous'}:{bot:values.practice});
  const room=await lobby.post<{id:string;watch:string;players:{token?:string}[]}>('/rooms',{players,map,chat:true,prepMs:1000,sides:'fixed',seed:17});
  token=room.players[0].token;
  console.log(`Match ${room.id}\nWatch: ${server}${room.watch}\nReplay after completion: ${server}/replay/${room.id}`);
}
if(!token)throw new Error('Set CASTELLAN_TOKEN or use --practice eco');
const controller=new AbortController();
process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
const outDir=resolve(values.out??`/tmp/castellan-autonomous-${Date.now()}`);
console.log(`Trace and checkpoint: ${outDir}`);
const result=await runPlayer(httpTransport(server,token),{pollMs:poll,outDir,signal:controller.signal,onLog:entry=>{if(['plan','plan-completed','plan-abandoned','outcome'].includes(String(entry.type)))console.log(JSON.stringify(entry));}});
console.log(JSON.stringify(result));

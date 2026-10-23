import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Order, OrderResult, PlayerView, Ruleset } from '../../../packages/shared/src/index';
import { AutonomousPlayer, type PlayerMemory, type PlayerOptions } from './player';

export interface PlayerTransport {
  rules():Promise<Ruleset>;
  status():Promise<{room:string;player:string;status:string}>;
  state(since:number):Promise<PlayerView>;
  act(orders:Order[],since:number):Promise<{results:OrderResult[];view:PlayerView}>;
}
/** Deliberately no spectator, room-inspection, replay or arbitrary request method. */
export function httpTransport(server:string,token:string,timeoutMs=10000):PlayerTransport {
  const base=new URL(server);
  if(!['http:','https:'].includes(base.protocol))throw new Error('CASTELLAN_SERVER must be HTTP(S)');
  async function request<T>(path:string,body?:unknown):Promise<T> {
    const response=await fetch(new URL(path,base),{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-castellan-agent':encodeURIComponent(JSON.stringify({connector:'autonomous',model:'heuristic',memoryPolicy:'local-checkpoint',contextPolicy:'player-view-only'}))},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeoutMs)});
    if(!response.ok)throw new Error(`player API ${response.status} at ${path.split('?')[0]}`);
    return await response.json() as T;
  }
  return {
    rules:async()=>(await request<{ruleset:Ruleset}>('/guide')).ruleset,
    status:()=>request('/status'),
    state:(since)=>request(`/state?since=${Math.max(0,since)}`),
    act:(orders,since)=>request('/act',{orders,since:Math.max(0,since)}),
  };
}
export interface RunOptions extends Omit<PlayerOptions,'memory'|'log'> {
  outDir:string;pollMs?:number;signal?:AbortSignal;onLog?:(entry:Record<string,unknown>)=>void;
}
interface Checkpoint { version:1; room:string;player:string;rulesHash:string;memory:PlayerMemory }
export async function runPlayer(transport:PlayerTransport,options:RunOptions) {
  mkdirSync(options.outDir,{recursive:true});
  const logPath=join(options.outDir,'trace.jsonl'),checkpointPath=join(options.outDir,'memory.json');
  const log=(entry:Record<string,unknown>)=>{const row={wallTime:new Date().toISOString(),...entry};appendFileSync(logPath,JSON.stringify(row)+'\n',{mode:0o600});options.onLog?.(row);};
  const [rules,status]=await Promise.all([transport.rules(),transport.status()]);
  const rulesHash=createHash('sha256').update(JSON.stringify(rules)).digest('hex');
  let memory:PlayerMemory|undefined;
  try {
    const saved=JSON.parse(readFileSync(checkpointPath,'utf8')) as Checkpoint;
    if(saved.version!==1||saved.room!==status.room||saved.player!==status.player||saved.rulesHash!==rulesHash)throw new Error('checkpoint belongs to a different match/player/ruleset; choose a different --out directory');
    memory=saved.memory;
    // Revalidate script installation after a process restart.
    memory.scripts={};
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const player=new AutonomousPlayer(rules,{...options,memory,log});
  const checkpoint=()=>{
    const data:Checkpoint={version:1,room:status.room,player:status.player,rulesHash,memory:player.memory};
    mkdirSync(dirname(checkpointPath),{recursive:true});
    writeFileSync(checkpointPath+'.tmp',JSON.stringify(data,null,2),{mode:0o600});renameSync(checkpointPath+'.tmp',checkpointPath);
  };
  const sourceHashes=Object.fromEntries(['player.ts','scripts.ts','runtime.ts'].map(name=>[name,createHash('sha256').update(readFileSync(fileURLToPath(new URL(name,import.meta.url)))).digest('hex')]));
  log({type:'session',room:status.room,player:status.player,rulesHash,sourceHashes,rulesVersion:rules.version,decisionPolicy:'local',pollMs:options.pollMs??1000,resumed:!!memory});
  let failures=0;
  try {
    while(!options.signal?.aborted) {
      try {
        const view=await transport.state(player.memory.lastTick);
        const orders=player.step(view);
        if(view.status==='finished') {checkpoint();return {room:status.room,player:status.player,outcome:view.outcome,metrics:player.memory.metrics};}
        if(orders.length) {
          // Persist intent before transport: never replay an ambiguous training/research request after a disconnect.
          checkpoint();
          try {const receipt=await transport.act(orders,view.tick);player.feedback(orders,receipt.results,receipt.view);}
          catch(error){log({type:'execution-uncertain',tick:view.tick,orders,error:String(error),recovery:'observe and reconcile; do not resend this batch'});}
        }
        checkpoint();failures=0;
      }catch(error){failures++;log({type:'transport-failure',error:String(error),failures});if(failures>=30)throw error;}
      await delay(Math.min(10000,(options.pollMs??1000)*Math.max(1,failures)),options.signal);
    }
    checkpoint();return {room:status.room,player:status.player,interrupted:true};
  }finally{player.close();}
}
function delay(ms:number,signal?:AbortSignal){return new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true});if(signal?.aborted)done();});}

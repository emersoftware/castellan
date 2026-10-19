import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildServer } from '../../../packages/server/src/app';
import { rules } from '../../../packages/shared/src/index';
import { httpTransport, runPlayer, type PlayerTransport } from '../src/runtime';

it('runs the HTTP lifecycle, reconciles a lost action reply, and writes a bound checkpoint without the capability', async()=>{
  const out=await mkdtemp(join(tmpdir(),'castellan-runtime-test-'));
  const app=await buildServer({replayDir:join(out,'replays'),ruleset:{...rules,matchMs:2200},prepMs:0});
  await app.listen({port:0,host:'127.0.0.1'});
  const address=app.server.address();
  const server=`http://127.0.0.1:${typeof address==='object'&&address?address.port:0}`;
  try {
    const room=await (await fetch(server+'/rooms',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({players:[{name:'player'},{bot:'eco'}],prepMs:0})})).json() as {id:string;players:{token:string}[]};
    const transport=httpTransport(server,room.players[0].token);
    let lost=false;
    const fault:PlayerTransport={...transport,act:async(...args)=>{const result=await transport.act(...args);if(!lost){lost=true;throw new Error('simulated connection loss AFTER accepted action');}return result;}};
    const result=await runPlayer(fault,{outDir:join(out,'player'),pollMs:200});
    expect(result.outcome?.reason).toBe('timeout');
    const log=await readFile(join(out,'player','trace.jsonl'),'utf8');
    expect(log).toContain('execution-uncertain');
    expect(log).not.toContain(room.players[0].token);
    const saved=JSON.parse(await readFile(join(out,'player','memory.json'),'utf8'));
    expect(saved).toMatchObject({room:room.id,player:'p1',version:1});
    expect(saved.memory.scripts.worker).toBeDefined(); // reconciled by repeat-safe script install
    const final=await transport.state(0);
    // 200 mineral can buy exactly four workers. An ambiguous request is never resent as a batch.
    expect(final.players.find(p=>p.id==='p1')!.queuedPop).toBeLessThanOrEqual(4);
    expect(final.events.filter(e=>e.type==='training_queued'&&e.owner==='p1')).toHaveLength(2);
    await expect(runPlayer({...transport,status:async()=>({room:'different-room',player:'p1',status:'running'})},{outDir:join(out,'player')})).rejects.toThrow('different match');
  } finally {await app.close();await rm(out,{recursive:true,force:true});}
});

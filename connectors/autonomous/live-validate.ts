/** Full wall-clock game over HTTP, with all decisions made locally. */
import { buildServer } from '../../packages/server/src/app';
import { client } from '../cli/src/client';
import { httpTransport, runPlayer } from './src/runtime';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const out=resolve(process.argv[2]??'/tmp/aoa-autonomous-live');
await mkdir(out,{recursive:true});
const app=await buildServer({replayDir:join(out,'replays'),prepMs:1000});
await app.listen({host:'127.0.0.1',port:0});
const addr=app.server.address();
const server=`http://127.0.0.1:${typeof addr==='object'&&addr?addr.port:0}`;
try {
  const room=await client({server}).post<{id:string;players:{token:string}[]}>('/rooms',{players:[{name:'Autonomous'},{bot:'eco'}],sides:'fixed',seed:41,chat:true,map:'open'});
  console.log(JSON.stringify({type:'started',room:room.id,server,out}));
  const start=Date.now();
  const result=await runPlayer(httpTransport(server,room.players[0].token),{outDir:join(out,'player'),onLog:entry=>{if(!['observation','accepted','attempt'].includes(String(entry.type)))console.log(JSON.stringify(entry));}});
  // Allow the room's replay write to settle, then the summary names its file without reading it into the player.
  await writeFile(join(out,'result.json'),JSON.stringify({wallElapsedMs:Date.now()-start,...result},null,2));
  console.log(JSON.stringify({type:'finished',wallElapsedMs:Date.now()-start,result}));
}finally{await app.close();}

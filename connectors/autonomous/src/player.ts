import type { EntityView, Order, OrderResult, PlayerView, Ruleset } from '../../../packages/shared/src/index';
import { armyScript, kingScript, workerScript, type Point } from './scripts';

export type Purpose = 'expansion' | 'defense' | 'rebuild';
export interface BuildTask extends Point { kind: string; worker?: string; issuedMs?: number; attempts: number; done?: boolean }
export interface BuildPlan { id: string; purpose: Purpose; anchor: Point; tasks: BuildTask[]; createdMs: number; status: 'active'|'completed'|'abandoned'; reason: string }
export interface PlayerMemory {
  version: 1; you?: string; lastTick: number; lastTimeMs: number; lastDecisionMs: number; serial: number;
  home?: Point; goal?: Point; stance: 'hold'|'fortify'|'evacuate'|'attack'; composition: 'balanced'|'ranged'|'cavalry'|'siege';
  plan?: BuildPlan; plans: BuildPlan[]; scripts: Record<string,string>;
  sightings: Record<string, EntityView & {seenMs:number}>; cooldowns: Record<string,number>;
  chatSeen: string[]; lastChatMs: number; coordination?: { from:string; point:Point; untilMs:number; action:string };
  treaties: Record<string,number>; proposedTo?: string; lastProposalMs?:number;
  scout?: {id:string;goal:Point;sinceMs:number};
  cancelledBuilds?: Record<string,{kind:string;x:number;y:number}>;
  metrics: { income:number; losses:number; rejections:number; completed:Record<string,number> };
}
export interface PlayerOptions {
  log?: (event: Record<string,unknown>)=>void;
  strategicIntervalMs?:number; memory?:PlayerMemory;
}
const dist=(a:Point,b:Point)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
const key=(p:Point)=>`${p.x},${p.y}`;
const initialMemory=():PlayerMemory=>({version:1,lastTick:-1,lastTimeMs:0,lastDecisionMs:-1e9,serial:0,stance:'hold',composition:'balanced',plans:[],scripts:{},sightings:{},cooldowns:{},chatSeen:[],lastChatMs:-1e9,treaties:{},metrics:{income:0,losses:0,rejections:0,completed:{}}});

/** Only public rules, player observations and order receipts enter this controller. No engine access. */
export class AutonomousPlayer {
  readonly memory: PlayerMemory;
  private out: Order[]=[];
  private chatPending?: Order & {type:'chat'};
  constructor(readonly rules:Ruleset, readonly options:PlayerOptions={}) {
    this.memory=options.memory??initialMemory();
    // Older checkpoints may contain external advice. Recompute strategy locally on migration.
    const legacy=this.memory as unknown as Record<string,unknown>;
    for(const field of ['lastAdviceMs','advisorCalls','defenseChoice','diplomacyChoice','campaignChoice']) {
      if(field in legacy){delete legacy[field];this.memory.lastDecisionMs=-1e9;}
    }
    // JSON persistence duplicates shared references. The active plan is authoritative on resume.
    if(this.memory.plan){const index=this.memory.plans.findIndex(p=>p.id===this.memory.plan!.id);if(index>=0)this.memory.plans[index]=this.memory.plan;else this.memory.plans.push(this.memory.plan);}
  }
  private log(type:string,view:Pick<PlayerView,'tick'|'timeMs'>,data:Record<string,unknown>={}) { if(this.options.log)this.options.log(structuredClone({type,tick:view.tick,timeMs:view.timeMs,...data})); }
  close() { this.out=[];this.chatPending=undefined; }

  /** Both strategy and routine execution are local and synchronous. */
  step(v:PlayerView):Order[] {
    this.out=[];
    if(this.memory.you && this.memory.you!==v.you) throw new Error('memory belongs to another player');
    this.memory.you=v.you;
    if(v.tick<this.memory.lastTick) throw new Error('observation clock went backwards; use a separate memory per match');
    this.observe(v);
    if(v.status==='finished') { this.close();this.log('outcome',v,{outcome:v.outcome,metrics:this.memory.metrics});return []; }
    const me=v.players.find(p=>p.id===v.you);
    if(v.status!=='running'||!me?.alive) return [];
    const castles=v.mine.filter(e=>e.kind==='castle');
    const king=v.mine.find(e=>e.kind==='king');
    if(!this.memory.home) {const h=castles[0]??king??{x:0,y:0};this.memory.home={x:h.x,y:h.y};}
    const safe=this.safeHome(v);
    this.readChat(v);
    this.reconcilePlan(v);
    if(v.timeMs-this.memory.lastDecisionMs >= (this.options.strategicIntervalMs??5000)) {
      this.strategy(v);this.memory.lastDecisionMs=v.timeMs;
    }
    this.emergencies(v);
    this.ensureScript(v,'worker',workerScript);
    this.ensureScript(v,'king',kingScript(safe));
    const goal=this.memory.goal??safe;
    const truces=Object.keys(this.memory.treaties).filter(id=>this.memory.treaties[id]>v.timeMs);
    const script=armyScript(safe,goal,this.memory.stance==='attack',truces,this.memory.stance==='evacuate');
    for(const kind of ['knight','archer']) this.ensureScript(v,kind,script);
    // Cancellation is a persistent intent until an observation confirms it. An ambiguous
    // stop response must not release money while the old builder can still spend it.
    let available=(me.mineral??0)-this.flushCancelledBuilds(v);
    const plan=this.memory.plan;
    if(plan?.status==='active') {
      const task=plan.tasks.find(t=>!t.done);
      if(task) {
        const cost=this.rules.kinds[task.kind]?.cost??0;
        // Reserve before training, from acceptance until completed spawn, including travel.
        available-=cost;
        if((me.mineral??0)>=cost) this.executeConstruction(v,task);
      }
    }
    available=this.produce(v,Math.max(0,available));
    this.research(v,available);
    this.scout(v);
    this.communicate(v);
    const orders=this.out.slice(0,50);
    if(orders.length)this.log('attempt',v,{orders,planId:this.memory.plan?.id});
    return orders;
  }

  /** Receipts are execution evidence; an accepted build is not a completed building. */
  feedback(orders:Order[],results:OrderResult[],v:PlayerView) {
    orders.forEach((order,i)=>{
      const result=results[i];
      if(!result) {this.log('execution-uncertain',v,{order,reason:'missing receipt; reconcile next observation'});return;}
      this.log(result.ok?'accepted':'execution-failure',v,{order,result,planId:this.memory.plan?.id});
      if(result.ok) {
        if(order.type==='script') this.memory.scripts[order.kind]=order.code??'';
        if(order.type==='chat') {this.memory.lastChatMs=v.timeMs;this.chatPending=undefined;}
        if(order.type==='build') {
          const task=this.memory.plan?.tasks.find(t=>!t.done&&t.kind===order.kind&&t.x===order.x&&t.y===order.y);
          if(task){task.worker=order.unit;task.issuedMs=v.timeMs;}
        }
      } else {
        this.memory.metrics.rejections++;
        if(order.type==='build') {
          const task=this.memory.plan?.tasks.find(t=>!t.done&&t.x===order.x&&t.y===order.y);
          if(task){task.worker=undefined;task.issuedMs=undefined;task.attempts++;}
          this.memory.cooldowns[`site:${key(order)}`]=v.timeMs+5000;
        }
        if(order.type==='script') delete this.memory.scripts[order.kind];
        if(order.type==='chat') this.memory.lastChatMs=v.timeMs; // cooldown also on rejection
      }
    });
    this.observe(v);
  }

  private observe(v:PlayerView) {
    if(v.tick<=this.memory.lastTick)return;
    this.log('observation',v,{view:v});
    for(const e of v.enemy) if(!e.ruin)this.memory.sightings[e.id]={...e,seenMs:v.timeMs};
    for(const [id,e] of Object.entries(this.memory.sightings)) {
      if((v.visibility[e.y]?.[e.x]==='2'&&!v.enemy.some(n=>n.id===id))||(!this.rules.kinds[e.kind]?.building&&v.timeMs-e.seenMs>15000)) delete this.memory.sightings[id];
    }
    for(const event of v.events.filter(e=>e.tick>=this.memory.lastTick)) {
      if(event.type==='unload'&&event.owner===v.you)this.memory.metrics.income+=event.amount;
      if(event.type==='spawn'&&event.owner===v.you&&event.builder) this.memory.metrics.completed[event.kind]=(this.memory.metrics.completed[event.kind]??0)+1;
      if(event.type==='death'&&event.owner===v.you){this.memory.metrics.losses++;this.log('loss',v,{event,planId:this.memory.plan?.id});}
      if(event.type==='order_end'&&event.owner===v.you&&!['arrived','built'].includes(event.reason))this.log('execution-interrupted',v,{event,planId:this.memory.plan?.id});
      if(event.type==='script_error'&&event.owner===v.you)this.log('execution-failure',v,{event});
    }
    this.memory.lastTick=v.tick;this.memory.lastTimeMs=v.timeMs;
  }
  private enemies(v:PlayerView) {return Object.values(this.memory.sightings).filter(e=>!e.ruin && v.players.find(p=>p.id===e.owner)?.alive);}
  private power(e:EntityView) {const s=e.stats??this.rules.kinds[e.kind];return ((s.atk??0)*e.hp/e.maxHp)*(e.kind==='worker'?0.15:1)*(e.kind==='king'?0.2:1);}
  private threat(v:PlayerView,p:Point,radius=9) {return this.enemies(v).filter(e=>dist(e,p)<=radius).reduce((n,e)=>n+this.power(e),0);}
  private army(v:PlayerView){return v.mine.filter(e=>e.kind==='knight'||e.kind==='archer');}
  private safeHome(v:PlayerView):Point {
    const bases=v.mine.filter(e=>e.kind==='castle');
    const p=bases.sort((a,b)=>this.threat(v,a)-this.threat(v,b))[0]??this.memory.home??v.mine[0]??{x:0,y:0};
    return {x:p.x,y:p.y};
  }
  private ensureScript(v:PlayerView,kind:string,code:string){if(this.rules.kinds[kind]?.scriptable&&this.memory.scripts[kind]!==code)this.out.push({type:'script',kind,code});}

  private strategy(v:PlayerView) {
    const safe=this.safeHome(v), army=this.army(v), strength=army.reduce((n,e)=>n+this.power(e),0);
    const king=v.mine.find(e=>e.kind==='king');
    const homeThreat=this.threat(v,king??safe,10);
    const forward=this.memory.goal??safe;
    const localThreat=this.threat(v,forward,8);
    const old=this.memory.stance;
    if(homeThreat>0) {this.memory.stance=homeThreat>strength*1.5?'evacuate':'fortify';this.memory.goal=king??safe;}
    else if(this.memory.coordination&&this.memory.coordination.untilMs>v.timeMs) {
      this.memory.stance=this.memory.coordination.action==='attack'?'attack':'fortify';
      this.memory.goal=this.memory.coordination.point;
    } else if(localThreat>strength*1.35&&old==='attack') {this.memory.stance='evacuate';this.memory.goal=safe;this.log('strategic-failure',v,{reason:'attack outmatched; withdraw',strength,localThreat});}
    else if(army.length>=7 && strength>localThreat*1.2) {
      this.memory.stance='attack';
      const enemies=this.enemies(v).filter(e=>(this.memory.treaties[e.owner]??0)<=v.timeMs);
      const target=enemies.sort((a,b)=>(a.kind==='king'?-20:0)+dist(a,safe)-(b.kind==='king'?-20:0)-dist(b,safe))[0];
      this.memory.goal=target??this.frontier(v,safe);
    } else {this.memory.stance='hold';this.memory.goal=this.memory.plan?.status==='active'?this.memory.plan.anchor:safe;}
    const composition=this.enemies(v).filter(e=>e.kind==='knight').length>this.enemies(v).filter(e=>e.kind==='archer').length?'ranged':'balanced';
    this.memory.composition=composition;
    if(!this.memory.plan||this.memory.plan.status!=='active')this.chooseConstruction(v);
    this.log('decision',v,{stance:this.memory.stance,goal:this.memory.goal,composition:this.memory.composition,homeThreat,strength,previous:old,planId:this.memory.plan?.id});
  }

  /** Research scenarios can supply a strategic choice; executor and legality stay identical. */
  planConstruction(v:PlayerView,purpose:Purpose,anchor:Point,tasks:(Point&{kind:string})[],reason='scenario strategic choice'):BuildPlan {
    if(this.memory.plan?.status==='active')this.abandon(v,'replaced by new strategic choice');
    const plan:BuildPlan={id:`plan-${++this.memory.serial}`,purpose,anchor:{x:anchor.x,y:anchor.y},tasks:tasks.map(t=>({...t,attempts:0})),createdMs:v.timeMs,status:'active',reason};
    this.memory.plan=plan;this.memory.plans.push(plan);
    this.log('plan',v,{plan});return plan;
  }
  private abandon(v:PlayerView,reason:string) {
    const p=this.memory.plan;if(!p||p.status!=='active')return;
    p.status='abandoned';p.reason=reason;
    for(const t of p.tasks)if(t.worker&&v.mine.find(e=>e.id===t.worker)?.order?.startsWith('build'))(this.memory.cancelledBuilds??={})[t.worker]={kind:t.kind,x:t.x,y:t.y};
    this.memory.cooldowns[p.purpose]=v.timeMs+45000;
    this.log('plan-abandoned',v,{planId:p.id,reason});
  }
  private flushCancelledBuilds(v:PlayerView):number {
    let reserve=0;
    for(const [id,task] of Object.entries(this.memory.cancelledBuilds??{})) {
      const worker=v.mine.find(e=>e.id===id);
      if(worker?.order!==`build ${task.kind} ${task.x},${task.y}`){delete this.memory.cancelledBuilds![id];continue;}
      reserve+=this.rules.kinds[task.kind]?.cost??0;
      if(!this.out.some(o=>'unit'in o&&o.unit===id))this.out.push({type:'stop',unit:id});
    }
    return reserve;
  }
  private reconcilePlan(v:PlayerView) {
    const p=this.memory.plan;if(!p||p.status!=='active')return;
    for(const t of p.tasks) {
      if(t.done)continue;
      const built=v.mine.find(e=>e.kind===t.kind&&e.x===t.x&&e.y===t.y);
      if(built){t.done=true;this.log('construction-completed',v,{planId:p.id,task:t,entity:built.id});continue;}
      if(!t.worker) {
        const existing=v.mine.find(e=>e.kind==='worker'&&(e.order===`build ${t.kind} ${t.x},${t.y}`||(e.construction?.kind===t.kind&&e.construction.x===t.x&&e.construction.y===t.y)));
        if(existing){t.worker=existing.id;t.issuedMs=v.timeMs;this.log('execution-reconciled',v,{planId:p.id,worker:existing.id,reason:'observed accepted build after missing receipt'});}
      }
      if(t.worker) {
        const w=v.mine.find(e=>e.id===t.worker);
        if(!w||!w.order?.startsWith('build')){this.log('execution-interrupted',v,{planId:p.id,task:t,reason:w?'build order ended without completed structure':'builder lost'});t.worker=undefined;t.issuedMs=undefined;t.attempts++;}
        else if(v.timeMs-(t.issuedMs??v.timeMs)>(this.rules.kinds[t.kind]?.buildMs??0)+45000) {
          this.out.push({type:'stop',unit:w.id});t.worker=undefined;t.issuedMs=undefined;t.attempts++;this.memory.cooldowns[`site:${key(t)}`]=v.timeMs+5000;
          this.log('execution-failure',v,{planId:p.id,reason:'construction stalled; release builder',task:t});
        }
      }
      if(t.attempts>=3){this.abandon(v,'repeated execution failure; replan site');return;}
    }
    if(p.tasks.every(t=>t.done)){p.status='completed';this.log('plan-completed',v,{planId:p.id,purpose:p.purpose});return;}
    const defenders=this.army(v).filter(e=>dist(e,p.anchor)<12).reduce((n,e)=>n+this.power(e),0);
    if(this.threat(v,p.anchor,7)>defenders+30){this.abandon(v,'site overrun; preserve builders and economy');this.log('strategic-failure',v,{planId:p.id,reason:'site no longer defensible'});}
    else if(v.timeMs-p.createdMs>150000)this.abandon(v,'plan exceeded economic/travel deadline');
  }
  private chooseConstruction(v:PlayerView) {
    const home=this.safeHome(v), castles=v.mine.filter(e=>e.kind==='castle'), workers=v.mine.filter(e=>e.kind==='worker');
    if(!workers.length)return;
    if(!castles.length) {
      const site=this.site(v,home,4);if(site)this.planConstruction(v,'rebuild',site,[{kind:'castle',...site}],'replace lost dropoff and production');return;
    }
    const pressure=this.threat(v,home);
    const me=v.players.find(p=>p.id===v.you)!;
    const completedExpansion=this.memory.plans.find(p=>p.purpose==='expansion'&&p.status==='completed'&&castles.some(c=>dist(c,p.anchor)<2));
    const anchor=completedExpansion?.anchor??home;
    const defended=v.mine.some(e=>e.kind==='tower'&&dist(e,anchor)<6);
    if(!defended && (pressure>0||completedExpansion||((me.mineral??0)>1000)) && (this.memory.cooldowns.defense??0)<=v.timeMs) {
      const layout=this.defenseLayout(v,anchor);
      if(layout.length){this.planConstruction(v,'defense',anchor,layout,pressure?'cover threatened economy':'protect expansion with tower and gated wall');return;}
    }
    if(castles.length<2&&workers.length>=7&&this.army(v).length>=3&&pressure===0&&(this.memory.cooldowns.expansion??0)<=v.timeMs) {
      const deps=[...v.deposits,...v.lastSeen.filter(d=>'amount'in d)].filter(d=>d.amount>=300&&castles.every(c=>dist(c,d)>7)&&this.threat(v,d,9)<15);
      const dep=deps.sort((a,b)=>dist(a,home)-dist(b,home))[0];
      if(dep){const site=this.site(v,dep,2);if(site)this.planConstruction(v,'expansion',site,[{kind:'castle',...site}],'known rich deposit far from existing dropoff');}
    }
  }
  private site(v:PlayerView,p:Point,radius:number):Point|undefined {
    const sites:Point[]=[];
    for(let y=p.y-radius;y<=p.y+radius;y++)for(let x=p.x-radius;x<=p.x+radius;x++)if(this.free(v,{x,y}))sites.push({x,y});
    return sites.sort((a,b)=>dist(a,p)-dist(b,p)||dist(a,this.memory.home??p)-dist(b,this.memory.home??p))[0];
  }
  private free(v:PlayerView,p:Point) {
    return v.visibility[p.y]?.[p.x]==='2' && v.grid[p.y]?.[p.x]==='·' && !v.mine.concat(v.allies,v.enemy).some(e=>e.x===p.x&&e.y===p.y) && !v.deposits.some(d=>d.x===p.x&&d.y===p.y);
  }
  defenseLayout(v:PlayerView,anchor:Point):(Point&{kind:string})[] {
    // A short straight barrier with an allied gate; never place a door at a corner.
    const center={x:Math.floor(v.grid[0].length/2),y:Math.floor(v.grid.length/2)};
    const dx=Math.sign(center.x-anchor.x)||1,dy=Math.sign(center.y-anchor.y)||1;
    for(const horizontal of [true,false])for(const offset of [3,2,4]) {
      const door=horizontal?{x:anchor.x,y:anchor.y+dy*offset}:{x:anchor.x+dx*offset,y:anchor.y};
      const walls=[-1,1].map(i=>horizontal?{x:door.x+i,y:door.y}:{x:door.x,y:door.y+i});
      const tower=horizontal?{x:door.x,y:door.y-dy*2}:{x:door.x-dx*2,y:door.y};
      const sites=[tower,door,...walls];
      if(sites.every(s=>this.free(v,s))&&new Set(sites.map(key)).size===4) return [{kind:'tower',...tower},{kind:'door',...door},...walls.map(p=>({kind:'wall',...p}))];
    }
    const tower=this.site(v,anchor,3);return tower?[{kind:'tower',...tower}]:[];
  }
  private executeConstruction(v:PlayerView,t:BuildTask) {
    if(t.worker||(this.memory.cooldowns[`site:${key(t)}`]??0)>v.timeMs)return;
    if(v.visibility[t.y]?.[t.x]!=='2')return; // scout reveals, never probe hidden occupancy by issuing builds
    const worker=v.mine.filter(e=>e.kind==='worker'&&!e.order?.startsWith('build')&&!this.out.some(o=>'unit'in o&&o.unit===e.id)).sort((a,b)=>dist(a,t)-dist(b,t))[0];
    if(worker)this.out.push({type:'build',unit:worker.id,kind:t.kind,x:t.x,y:t.y});
  }

  private produce(v:PlayerView,budget:number):number {
    const me=v.players.find(p=>p.id===v.you)!;
    let slots=this.rules.popCap-(me.pop??v.mine.filter(e=>!this.rules.kinds[e.kind].building).length)-(me.queuedPop??0);
    const queue=(kind:string)=>v.mine.reduce((n,e)=>n+(e.training?.filter(j=>j.kind===kind).length??0),0)+this.out.filter(o=>o.type==='train'&&o.kind===kind).length;
    const workers=v.mine.filter(e=>e.kind==='worker').length;
    const desired=v.mine.filter(e=>e.kind==='castle').length>1?11:8;
    for(const castle of v.mine.filter(e=>e.kind==='castle')) {
      if(slots<=0||(castle.training?.length??0)>=2)continue;
      let kind:string;
      const n=this.army(v).length;
      if(workers+queue('worker')<desired&&(workers+queue('worker')<6||n>=2||v.timeMs<35000))kind='worker';
      else {
        const knights=v.mine.filter(e=>e.kind==='knight').length+queue('knight'),archers=v.mine.filter(e=>e.kind==='archer').length+queue('archer');
        const fraction=this.memory.composition==='ranged'||this.memory.composition==='siege'?0.75:this.memory.composition==='cavalry'?0.2:0.5;
        kind=archers<(knights+archers+1)*fraction?'archer':'knight';
      }
      const spec=this.rules.kinds[kind];
      if(spec&&budget>=spec.cost&&(!spec.requires||(me.upgrades?.[spec.requires]??0)>0)) {this.out.push({type:'train',building:castle.id,kind});budget-=spec.cost;slots--;}
    }
    return budget;
  }
  private research(v:PlayerView,budget:number) {
    const me=v.players.find(p=>p.id===v.you)!;if(me.research||this.army(v).length<5)return;
    const ids=this.memory.composition==='cavalry'?['knight_mobility','knight_damage','knight_cadence']:['archer_range','archer_damage','knight_mobility','tower_range'];
    for(const id of ids){const upgrade=this.rules.upgrades[id],next=upgrade?.levels[me.upgrades?.[id]??0];if(next&&budget>=next.cost+100){this.out.push({type:'upgrade',upgrade:id});break;}}
  }
  private emergencies(v:PlayerView) {
    const king=v.mine.find(e=>e.kind==='king');
    if(king&&this.threat(v,king,7)>0) {
      this.memory.goal=king;this.memory.stance='fortify';
      this.log('king-defense',v,{king:king.id,threat:this.threat(v,king,7)});
    }
    for(const w of v.mine.filter(e=>e.kind==='worker'&&e.order?.startsWith('build'))) {
      if(this.enemies(v).some(e=>this.power(e)>3&&dist(w,e)<=Math.max(e.stats?.range??this.rules.kinds[e.kind]?.range??1,3))) {
        if(!this.out.some(o=>'unit'in o&&o.unit===w.id))this.out.push({type:'stop',unit:w.id});
        this.abandon(v,'builder under attack; routine escape resumes');
      }
    }
    const scout=this.memory.scout;
    if(scout){const unit=v.mine.find(e=>e.id===scout.id);if(!unit){delete this.memory.scout;}else if(this.threat(v,unit,6)>0||v.timeMs-scout.sinceMs>20000){this.out.push({type:'stop',unit:unit.id});delete this.memory.scout;this.memory.cooldowns.scout=v.timeMs+12000;}}
  }
  private frontier(v:PlayerView,from:Point):Point {
    const points:Point[]=[];
    for(let y=1;y<v.grid.length-1;y++)for(let x=1;x<v.grid[y].length-1;x++) {
      if(v.visibility[y][x]==='0'&&[[x-1,y],[x+1,y],[x,y-1],[x,y+1]].some(([a,b])=>v.visibility[b]?.[a]!=='0') && v.grid[y][x]!=='^')points.push({x,y});
    }
    return points.sort((a,b)=>dist(a,from)-dist(b,from)||a.y-b.y)[0]??{x:Math.floor(v.grid[0].length/2),y:Math.floor(v.grid.length/2)};
  }
  private scout(v:PlayerView) {
    if((this.memory.cooldowns.scout??0)>v.timeMs||['attack','evacuate'].includes(this.memory.stance)||this.threat(v,this.safeHome(v))>0)return;
    if(this.memory.scout) {
      const s=this.memory.scout,u=v.mine.find(e=>e.id===s.id);
      if(u?.order?.startsWith('move'))return;
      delete this.memory.scout;
    }
    const scout=this.army(v).find(e=>!e.order);if(!scout)return;
    const goal=this.frontier(v,scout);if(dist(goal,scout)<2)return;
    this.memory.scout={id:scout.id,goal,sinceMs:v.timeMs};this.out.push({type:'move',unit:scout.id,...goal});
  }

  private readChat(v:PlayerView) {
    if(!v.chat?.enabled)return;
    const me=v.players.find(p=>p.id===v.you)!;
    for(const m of v.chat.messages) {
      const id=`${m.tick}:${m.from}:${m.text}`;if(m.from===v.you||this.memory.chatSeen.includes(id))continue;
      this.memory.chatSeen.push(id);this.memory.chatSeen=this.memory.chatSeen.slice(-100);
      const sender=v.players.find(p=>p.id===m.from);if(!sender?.alive)continue;
      const command=/^\[AOA1\] (defend|attack|rally) (\d+),(\d+)$/.exec(m.text);
      if(sender.team===me.team&&command) {
        const point={x:Number(command[2]),y:Number(command[3])};
        if(point.x>=v.grid[0].length||point.y>=v.grid.length)continue;
        if(command[1]==='defend'&&!v.allies.some(e=>dist(e,point)<=8))continue;
        this.memory.coordination={from:m.from,point,action:command[1],untilMs:v.timeMs+30000};this.memory.lastDecisionMs=-1e9;
        this.log('coordination-adopted',v,{from:m.from,action:command[1],point});
      }
      if(sender.team!==me.team&&v.players.length>2) {
        if(m.text==='[AOA1] truce 60'&&this.threatFrom(v,m.from,this.safeHome(v))===0) {
          this.memory.treaties[m.from]=v.timeMs+60000;this.chatPending={type:'chat',to:m.from,text:'[AOA1] accept 60'};this.log('treaty-accepted',v,{with:m.from,untilMs:v.timeMs+60000});
        } else if(m.text==='[AOA1] accept 60'&&this.memory.proposedTo===m.from&&(this.memory.lastProposalMs??-1e9)+30000>=v.timeMs) {
          this.memory.treaties[m.from]=v.timeMs+60000;this.log('treaty-confirmed',v,{with:m.from});
        }
      }
    }
    for(const id of Object.keys(this.memory.treaties))if(this.threatFrom(v,id,this.safeHome(v))>0){delete this.memory.treaties[id];this.log('treaty-broken',v,{with:id,reason:'armed incursion near home'});}
  }
  private threatFrom(v:PlayerView,id:string,p:Point){return v.enemy.filter(e=>e.owner===id&&dist(e,p)<9).reduce((n,e)=>n+this.power(e),0);}
  private communicate(v:PlayerView) {
    if(!v.chat?.enabled||v.timeMs-this.memory.lastChatMs<10000)return;
    const me=v.players.find(p=>p.id===v.you)!,ally=v.players.find(p=>p.id!==v.you&&p.team===me.team&&p.alive);
    if(this.chatPending){this.out.push(this.chatPending);return;}
    if(ally) {
      const defend=this.threat(v,this.safeHome(v))>0;
      const action=defend?'defend':this.memory.stance==='attack'?'attack':'rally';
      const goal=defend?this.safeHome(v):this.memory.goal??this.safeHome(v);
      // Don't echo a received rally back indefinitely.
      if(!this.memory.coordination||this.memory.coordination.untilMs<=v.timeMs||defend)this.out.push({type:'chat',channel:'team',text:`[AOA1] ${action} ${goal.x},${goal.y}`});
    } else if(v.players.filter(p=>p.alive).length>2&&v.timeMs-(this.memory.lastProposalMs??-1e9)>90000) {
      const peer=v.players.find(p=>p.id!==v.you&&p.alive&&!this.threatFrom(v,p.id,this.safeHome(v)));
      if(peer){this.memory.proposedTo=peer.id;this.memory.lastProposalMs=v.timeMs;this.out.push({type:'chat',to:peer.id,text:'[AOA1] truce 60'});}
    }
  }

}

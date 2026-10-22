/**
 * Parameterised unit scripts (public script API only). They are compact on
 * purpose: the rules cap a script's size (`script.maxBytes`) including its baked-in JSON.
 */
import type { Pt } from "./geometry";

export interface ArmyParams {
  /** Default role for units not listed: g (guard), a (attack), r (retreat), h (hold a post inside the keep). */
  role: "g" | "a" | "r" | "h";
  roles: Record<string, "g" | "a" | "r" | "s" | "h">;
  rally: Pt;
  /** Attack destination; guards hold `gp` (defaults to the rally point). */
  target: Pt | null;
  gp: Pt | null;
  /** Individual posts (turtle mode); otherwise gp or the rally point. */
  posts: Record<string, Pt>;
  leash: number;
  engage: number;
  /** Scout waypoints, for role s. */
  wps: Pt[];
  kite: boolean;
}

export interface WorkerParams {
  safe: Pt;
  /** Deposit id per worker; absent = nearest. */
  assign: Record<string, string>;
  /** Hiding tile per worker while the base is under attack. */
  evac: Record<string, Pt>;
  fleeRadius: number;
  fleeTicks: number;
}

export interface KingParams { safe: Pt }

/**
 * Shared body for knights and archers. Variables: P params, me/m self and memory,
 * es visible enemies (nearest first), U mobile units, F fighters, B strong buildings,
 * pk(list) softest target, go(p) move to p, stk() stuck detector, role/post of this unit.
 */
const COMMON = `const d2=(a,b)=>{const n=(a.x-b.x)*(a.x-b.x)+(a.y-b.y)*(a.y-b.y),r=Math.floor(Math.sqrt(n));return n-r*r>r?r+1:r};
const me=self,m=me.memory,role=P.roles[me.id]||P.role,post=P.posts[me.id]||P.gp||P.rally;
const es=me.nearbyEnemies().filter(e=>!e.ruin),U=es.filter(e=>!e.isBuilding),F=U.filter(e=>e.type!="worker");
const sw=e=>e.type=="wall"||e.type=="door",B=es.filter(e=>e.isBuilding&&!sw(e));
const sc=e=>(e.isBuilding?1000:e.type=="worker"?500:0)+e.hp,pk=l=>l.reduce((a,b)=>sc(b)<sc(a)?b:a);
const near=F[0]||U[0],dp=p=>me.distanceToPos(p.x,p.y),go=p=>{if(dp(p)>0)me.moveTo(p.x,p.y);else me.hold()};
const stk=()=>{const r=me.lastActionResult;m.k=r&&r.status=="blocked"?(m.k||0)+1:0;return m.k>8};
const roles=()=>{
if(role=="h"){const i=me.enemiesInRange();if(i.length&&(me.attackReadyInTicks||0)==0)me.attack(pk(i));else if(dp(post)>0)me.moveTo(post.x,post.y);else me.hold()}
else if(role=="r"){if(near&&me.distanceTo(near)<=me.range&&dp(post)<=2)me.attack(near);else if(dp(post)>1)me.moveTo(post.x,post.y);else if(near&&me.distanceTo(near)<=me.range)me.attack(near);else me.hold()}
else if(role=="s"){m.w=m.w||0;if(near&&me.distanceTo(near)<=6){m.w=P.wps.length;me.moveTo(P.rally.x,P.rally.y)}
else if(m.w>=P.wps.length){if(dp(P.rally)>1)me.moveTo(P.rally.x,P.rally.y);else me.hold()}
else{const w=P.wps[m.w];if(dp(w)<=2||stk()){m.w++;m.k=0;me.hold()}else me.moveTo(w.x,w.y)}}
else if(role=="a"){const t=P.target||post,u=F.find(e=>me.distanceTo(e)<=P.engage)||U.find(e=>me.distanceTo(e)<=P.engage-2),b=B.find(e=>me.distanceTo(e)<=P.engage);
if(u)me.attack(u);else if(b)me.attack(b);else if(m.b&&es.some(e=>e.id==m.b))me.attack(m.b);else if(dp(t)<=2){const a=es[0];if(a&&me.distanceTo(a)<=6)me.attack(a);else me.hold()}
else if(stk()){const w=es.find(sw);if(w){m.b=w.id;me.attack(w)}else{m.k=0;go(t)}}else{m.b=null;go(t)}}
else{const u=F.find(e=>d2(e,post)<=P.leash)||U.find(e=>d2(e,post)<=P.leash-2),b=B.find(e=>d2(e,post)<=P.leash);
if(u)me.attack(u);else if(b)me.attack(b);else if(dp(post)>2)me.moveTo(post.x,post.y);else me.hold()}};
`;

export function knightScript(p: ArmyParams): string {
  return `// castellan knight: guard a post, attack toward a target, retreat or scout (roles from the player).
const P=${JSON.stringify(p)};
${COMMON}const inr=me.enemiesInRange();
if(role=="s"||role=="h")roles();else if(inr.length&&(me.attackReadyInTicks||0)==0)me.attack(pk(inr));else roles();
`;
}

export function archerScript(p: ArmyParams): string {
  return `// castellan archer: kite melee, shoot the softest target in range, otherwise follow the role.
const P=${JSON.stringify(p)};
${COMMON}const ml=F.find(e=>(e.range||1)<=1&&me.distanceTo(e)<=2),inr=me.enemiesInRange(),rd=(me.attackReadyInTicks||0)==0&&(me.aimReadyInTicks||0)==0;
if(role=="s"||role=="r"||role=="h")roles();else if(ml&&P.kite&&!rd)me.flee(ml);else if(inr.length)me.attack(pk(inr));else roles();
`;
}

export function workerScript(p: WorkerParams): string {
  return `// castellan worker: mine an assigned deposit; run to safety when a hostile fighter comes close.
const P=${JSON.stringify(p)};
const me=self,m=me.memory,foes=me.nearbyEnemies().filter(e=>!e.isBuilding&&!e.ruin&&e.type!="worker"),r=me.lastActionResult,ev=P.evac[me.id];
if(ev&&!(foes.length&&me.distanceTo(foes[0])<=2)){if(me.distanceToPos(ev.x,ev.y)>0)me.moveTo(ev.x,ev.y);else me.hold()}
else if(foes.length&&me.distanceTo(foes[0])<=P.fleeRadius){m.f=me.tick;if(r&&r.status=="blocked"&&r.action&&r.action.a=="moveTo")me.flee(foes[0]);else me.moveTo(P.safe.x,P.safe.y)}
else if(m.f!==undefined&&me.tick-m.f<P.fleeTicks){if(me.carrying>0)me.unload();else me.hold()}
else{const d=P.assign[me.id];if(d&&me.deposits().some(x=>x.id==d))me.gather(d);else me.gather()}
`;
}

export function kingScript(p: KingParams): string {
  return `// castellan king: stay at the safe spot; hit back only at an adjacent attacker.
const P=${JSON.stringify(p)};
const me=self,a=me.lastAttacker();
if(a&&me.distanceTo(a)<=me.range&&me.distanceToPos(P.safe.x,P.safe.y)<=1)me.attack(a);
else if(me.distanceToPos(P.safe.x,P.safe.y)>0)me.moveTo(P.safe.x,P.safe.y);else me.hold();
`;
}

/** Towers and castles: fighters before workers, workers before buildings; lowest hp first. */
export const STATIC_SCRIPT = `// castellan static: prefer fighters, then workers, then buildings; lowest hp first.
const sc=e=>(e.isBuilding?1000:e.type=="worker"?500:0)+e.hp,t=self.enemiesInRange().filter(e=>!e.ruin);
if(!t.length)self.hold();else self.attack(t.reduce((a,b)=>sc(b)<sc(a)?b:a));
`;

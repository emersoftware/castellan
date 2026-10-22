/** Tick-level routines run by the existing player sandbox, including during LLM latency. */
export interface Point { x: number; y: number }

export const workerScript = `
const enemies = self.nearbyEnemies().filter(e => !e.ruin && e.atk > 0 && e.type !== 'worker');
const danger = enemies.find(e => self.distanceTo(e) <= Math.max(3,e.range+1));
if (danger) self.flee(danger);
else {
  const deposits = self.deposits().filter(d => d.amount > 0 && !enemies.some(e => Math.max(Math.abs(d.x-e.x),Math.abs(d.y-e.y)) < e.range+3));
  if (self.carrying >= self.carryCapacity || (!deposits.length && self.carrying)) self.unload();
  else if (deposits.length) self.gather(deposits[0]);
  else self.hold();
}`;

export function kingScript(home: Point): string {
  return `const home=${JSON.stringify(home)};
const e=self.nearbyEnemies().filter(e=>!e.ruin&&e.atk>0).sort((a,b)=>self.distanceTo(a)-self.distanceTo(b))[0];
if(e&&self.distanceTo(e)<=Math.max(e.range+2,4)) self.flee(e);
else if(self.distanceToPos(home.x,home.y)>2) self.moveTo(home.x,home.y);
else self.hold();`;
}

export function armyScript(home: Point, goal: Point, attacking: boolean, truces: string[], retreating=false): string {
  return `const home=${JSON.stringify({x:home.x,y:home.y})},goal=${JSON.stringify({x:goal.x,y:goal.y})},go=${attacking},retreat=${retreating},truces=${JSON.stringify(truces)};
const steps=(a,b)=>Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y));
const enemies=self.nearbyEnemies().filter(e=>!e.ruin && (!truces.includes(e.owner)||steps(e,home)<9||self.distanceTo(e)<3));
const near=enemies.filter(e=>self.distanceTo(e)<=Math.max(self.range,e.range)+2);
const target=(near.length?near:enemies).sort((a,b)=>(a.type==='king'?-8:0)+(a.isBuilding?4:0)+self.distanceTo(a)-(b.type==='king'?-8:0)-(b.isBuilding?4:0)-self.distanceTo(b))[0];
const close=near.filter(e=>!e.isBuilding).sort((a,b)=>self.distanceTo(a)-self.distanceTo(b))[0];
if(retreat && self.distanceToPos(home.x,home.y)>3) self.moveTo(home.x,home.y);
else if(self.hp<self.maxHp*0.25 && close && self.distanceToPos(home.x,home.y)>3) self.flee(close);
else if(self.type==='archer' && close && close.range<3 && self.distanceTo(close)<=2 && self.moveReadyInTicks===0) self.flee(close);
else if(target && self.distanceTo(target)<=self.range && self.distanceTo(target)>=self.minRange) self.attack(target);
else if(target && (go || steps(target,goal)<7)) self.attack(target);
else if(self.distanceToPos(goal.x,goal.y)>2) self.moveTo(goal.x,goal.y);
else self.hold();`;
}

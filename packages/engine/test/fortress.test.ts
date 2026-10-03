import { expect, it } from "vitest";
import { rules, MAPS } from "@aoa/shared";
import { createMatch, findPath } from "../src";
import type { Grid } from "../src/grid";

it("starts both players in symmetric, sealed corner fortresses with two allied exits", async () => {
  const map = MAPS.fortress;
  const m = await createMatch({ ruleset: { ...rules, map }, players: [{id:"a",name:"A"},{id:"b",name:"B"}], seed:1,tickRate:10 });
  try {
    const frame = m.spectate();
    const occupied = [...frame.entities, ...frame.deposits];
    expect(new Set(occupied.map(e=>`${e.x},${e.y}`)).size).toBe(occupied.length);
    const mine=frame.entities.filter(e=>e.owner==="a");
    for(const owner of ["a","b"]) {
      expect(frame.entities.filter(e=>e.owner===owner&&e.kind==="door")).toHaveLength(2);
      expect(frame.entities.filter(e=>e.owner===owner&&e.kind==="wall")).toHaveLength(25);
    }
    for(const e of mine) expect(frame.entities).toContainEqual(expect.objectContaining({kind:e.kind,owner:"b",x:31-e.x,y:31-e.y}));
    const inside=(x:number,y:number)=>x<13&&y<13;
    expect(map.deposits.every(d=>inside(d.x,d.y))).toBe(true);
    const barriers=mine.filter(e=>e.kind==="wall"||e.kind==="door");
    const grid:Grid={width:32,height:32,isStatic:(x,y)=>barriers.some(e=>e.x===x&&e.y===y)};
    // No path around the ends of either wall via the map edge, including diagonals.
    expect(findPath(grid,4,4,15,15,0)).toBeNull();
    for(const door of barriers.filter(e=>e.kind==="door")) {
      const allied:Grid={...grid,isStatic:(x,y)=>grid.isStatic(x,y)&&!(x===door.x&&y===door.y)};
      expect(findPath(allied,4,4,15,15,0)).not.toBeNull();
    }
    const worker=mine.find(e=>e.kind==="worker")!;
    m.step([{player:"a",order:{type:"script",kind:"worker",code:"self.hold();"}},{player:"a",order:{type:"move",unit:worker.id,x:14,y:7}}]);
    for(let i=0;i<100;i++)m.step([]);
    expect(m.view("a").mine.find(e=>e.id===worker.id)).toMatchObject({x:14,y:7});
  } finally {m.dispose();}
});

it("rotates four sealed fortresses without overlaps and lets each player exit its own gates", async () => {
  const { seatToMap } = await import("../src/grid");
  const map = MAPS["fortress-quad"];
  const W = map.width;
  const players = Array.from({length:4},(_,side)=>({id:`p${side}`,name:`P${side}`,side,team:side}));
  const m = await createMatch({ruleset:{...rules,map},players,seed:1,tickRate:10});
  try {
    const frame=m.spectate(), occupied=[...frame.entities,...frame.deposits];
    expect(map.seats).toBe(4);
    expect(new Set(occupied.map(e=>`${e.x},${e.y}`)).size).toBe(occupied.length);
    const orders=[];
    for(const p of players) {
      const mine=frame.entities.filter(e=>e.owner===p.id);
      expect(mine.filter(e=>e.kind==="door")).toHaveLength(2);
      expect(mine.filter(e=>e.kind==="wall")).toHaveLength(25);
      for(const s of MAPS.fortress.start) {
        const [x,y]=seatToMap(s.x,s.y,p.side,W,W);
        expect(mine).toContainEqual(expect.objectContaining({kind:s.kind,x,y}));
      }
      const [bx,by]=seatToMap(4,4,p.side,W,W);
      const barriers=mine.filter(e=>e.kind==="wall"||e.kind==="door");
      const grid:Grid={width:W,height:W,isStatic:(x,y)=>barriers.some(e=>e.x===x&&e.y===y)};
      expect(findPath(grid,bx,by,W/2,W/2,0)).toBeNull();
      for(const door of barriers.filter(e=>e.kind==="door")) {
        const passage:Grid={...grid,isStatic:(x,y)=>grid.isStatic(x,y)&&!(x===door.x&&y===door.y)};
        expect(findPath(passage,bx,by,W/2,W/2,0)).not.toBeNull();
      }
      expect(m.view(p.id).allies).toEqual([]);
      const [x,y]=seatToMap(14,7,p.side,W,W);
      orders.push({player:p.id,order:{type:"move" as const,unit:mine.find(e=>e.kind==="worker")!.id,x,y}});
    }
    // Hold workers after arriving (their default script would walk back to mine).
    m.step([...orders,...players.map(p=>({player:p.id,order:{type:"script" as const,kind:"worker",code:"self.hold();"}}))]);for(let i=0;i<100;i++)m.step([]);
    for(const {player,order} of orders) expect(m.view(player).mine.find(e=>e.id===order.unit)).toMatchObject({x:order.x,y:order.y});
  } finally {m.dispose();}
});

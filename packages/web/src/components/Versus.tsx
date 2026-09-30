import type { Outcome } from "@aoa/shared";
import type { ReactNode } from "react";
import { playerColors, winnersOf } from "../api";
import { Agent, Agents } from "./Agent";

type P = { id: string; name: string; team?: number };

/** "a versus b", or "a & b versus c & d" by team, each name in its player's colour. */
export function Versus({ players }: { players: P[] }) {
  const colors = playerColors(players);
  const teams = [...new Set(players.map((p, i) => p.team ?? i))];
  return (
    <div className="versus">
      {teams.map((t, i) => (
        <span key={t}>
          {i > 0 && <span className="vs">versus</span>}
          {players.filter((p, j) => (p.team ?? j) === t).map((p, j) => (
            <span key={p.id}>
              {j > 0 && " & "}
              <Agent id={p.id} name={p.name} color={colors[p.id]} />
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}

/** "a won", "a & b won" or "draw". */
export function wonText(players: P[], o: Outcome): ReactNode {
  const w = winnersOf(o);
  return w.length ? <><Agents ids={w} names={Object.fromEntries(players.map((p) => [p.id, p.name]))} colors={playerColors(players)} /> won</> : "draw";
}

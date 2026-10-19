import type { Outcome } from "@castellan/shared";
import type { ReactNode } from "react";
import { playerColors, winnersOf } from "../api";
import { Agent, Agents } from "./Agent";

type P = { id: string; name: string; team?: number; effort?: string | null };

/** "a versus b", or "a & b versus c & d" by team, each name in its player's colour. */
export function Versus({ players, showEffort = false }: { players: P[]; showEffort?: boolean }) {
  const colors = playerColors(players);
  const teams = [...new Set(players.map((p, i) => p.team ?? i))];
  return (
    <div className="versus">
      {teams.map((t, i) => (
        <span key={t}>
          {i > 0 && <> <span className="vs">versus</span> </>}
          {players.filter((p, j) => (p.team ?? j) === t).map((p, j) => (
            <span key={p.id}>
              {j > 0 && " & "}
              <Agent id={p.id} name={p.name} color={colors[p.id]} effort={showEffort ? p.effort ?? null : undefined} />
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}

/** Winning side, everyone defeated, or a historical draw. */
export function wonText(players: P[], o: Outcome): ReactNode {
  const w = winnersOf(o);
  return w.length ? <><Agents ids={w} names={Object.fromEntries(players.map((p) => [p.id, p.name]))} colors={playerColors(players)} /> won</> : o.allDefeated ? "all players defeated" : "draw";
}

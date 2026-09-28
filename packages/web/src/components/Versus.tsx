import type { Outcome } from "@aoa/shared";
import { playerColors, winnersOf } from "../api";

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
              <b className={`pc${colors[p.id]}`}>{p.name}</b>
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}

/** "a won", "a & b won" or "draw". */
export function wonText(players: P[], o: Outcome): string {
  const w = winnersOf(o).map((id) => players.find((p) => p.id === id)?.name ?? id);
  return w.length ? `${w.join(" & ")} won` : "draw";
}

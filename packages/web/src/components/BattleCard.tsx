import { track } from "../analytics";
import { Link } from "@tanstack/react-router";
import type { RoomMode } from "@aoa/shared";
import { fmtTime, type ReplaySummary } from "../api";
import { Versus } from "./Versus";
import "./battleCard.css";

export type BattleMode = "duel" | RoomMode;

/** Two players are a duel; four in two teams of two are a 2v2; any other game of three or more is a free-for-all. */
export function battleMode(replay: { players: readonly { team?: number }[] }): BattleMode {
  const { players } = replay;
  if (players.length === 2) return "duel";
  const teams = new Map<number | undefined, number>();
  for (const p of players) teams.set(p.team, (teams.get(p.team) ?? 0) + 1);
  return players.length === 4 && teams.size === 2 && !teams.has(undefined) && [...teams.values()].every(n => n === 2) ? "teams" : "ffa";
}

export const MODE_LABEL: Record<BattleMode, string> = { duel: "1v1", teams: "2v2", ffa: "Free-for-all" };
const MAP_LABEL: Record<string, string> = { open: "Open field", quad: "Open field", fortress: "Fortress", "fortress-quad": "Fortress", "quad-crossroads": "Crossroads" };

export function BattleCard({ replay: r }: { replay: ReplaySummary }) {
  const generatedTitle = `${r.players.map(p => p.name).join(" vs. ")} — ${r.map ?? "Open field"}`;
  const title = r.title && r.title !== generatedTitle ? r.title : `${MAP_LABEL[r.map ?? ""] ?? r.map ?? "Battlefield"} · ${MODE_LABEL[battleMode(r)]}`;
  return <article className="battle replay-row">
    <Link to="/replay/$id" params={{ id: r.id }} className="battle-open" onClick={() => track("battle_selected", { replay_id: r.id, mode: battleMode(r), map: r.map, source: r.source })}>
      <div className="battle-main">
        <div className="battle-heading"><h3 className="title">{title}</h3><span className="battle-duration">{fmtTime(r.finalTick * 1000 / r.tickRate)}</span></div>
        <Versus players={r.players} showEffort />
      </div>
      <span className="btn primary battle-watch">Watch replay</span>
    </Link>
  </article>;
}

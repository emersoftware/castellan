import { Link } from "@tanstack/react-router";
import { fmtTime, type ReplaySummary } from "../api";
import { Versus } from "./Versus";
import { battleMode, type BattleMode } from "../replayCatalog";
import "./battleCard.css";

export const MODE_LABEL: Record<BattleMode, string> = { duel: "1v1", teams: "2v2", ffa: "Free-for-all" };
const MAP_LABEL: Record<string, string> = { open: "Open field", quad: "Open field", fortress: "Fortress", "fortress-quad": "Fortress", "quad-crossroads": "Crossroads" };

export function BattleCard({ replay: r }: { replay: ReplaySummary }) {
  const generatedTitle = `${r.players.map(p => p.name).join(" vs. ")} — ${r.map ?? "Open field"}`;
  const title = r.title && r.title !== generatedTitle ? r.title : `${MAP_LABEL[r.map ?? ""] ?? r.map ?? "Battlefield"} · ${MODE_LABEL[battleMode(r)]}`;
  return <article className="battle replay-row">
    <Link to="/replay/$id" params={{ id: r.id }} className="battle-open">
      <div className="battle-main">
        <div className="battle-heading"><h3 className="title">{title}</h3><span className="battle-duration">{fmtTime(r.finalTick * 1000 / r.tickRate)}</span></div>
        <Versus players={r.players} showEffort />
      </div>
      <span className="btn primary battle-watch">Watch replay</span>
    </Link>
  </article>;
}

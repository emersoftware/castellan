import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { fmtTime, type ReplaySummary } from "../api";
import { Versus, wonText } from "./Versus";
import { battleMode, type BattleMode } from "../replayCatalog";

const MODE_LABEL: Record<BattleMode, string> = { duel: "Duel", teams: "2v2", ffa: "Free-for-all" };

export function BattleCard({ replay: r }: { replay: ReplaySummary }) {
  const [result, setResult] = useState(false);
  return <article className="battle">
    <Link to="/replay/$id" params={{ id: r.id }} className="battle-open">
      <div className="title">{r.title ?? `${r.map ?? "Battlefield"} · ${MODE_LABEL[battleMode(r)]}`}</div>
      <Versus players={r.players} />
      <div className="meta">{fmtTime(r.finalTick * 1000 / r.tickRate)}{r.source === "local" ? " · Local" : ""}</div>
    </Link>
    <button className="battle-result" onClick={() => setResult(!result)} aria-expanded={result}>{result ? wonText(r.players, r.outcome) : "Show result"}</button>
  </article>;
}

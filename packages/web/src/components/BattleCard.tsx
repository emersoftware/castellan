import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { fmtTime, type ReplaySummary } from "../api";
import { Versus, wonText } from "./Versus";

export function BattleCard({ replay: r }: { replay: ReplaySummary }) {
  const [result, setResult] = useState(false);
  return <article className="battle">
    <Link to="/replay/$id" params={{ id: r.id }} className="battle-open">
      <div className="title">{r.title ?? `${r.map ?? "Battlefield"} · ${r.players.length === 4 ? "Free-for-all" : "Duel"}`}</div>
      <Versus players={r.players} />
      <div className="meta">{fmtTime(r.finalTick * 1000 / r.tickRate)}{r.source === "local" ? " · Local" : ""}</div>
    </Link>
    <button className="battle-result" onClick={() => setResult(!result)} aria-expanded={result}>{result ? wonText(r.players, r.outcome) : "Show result"}</button>
  </article>;
}

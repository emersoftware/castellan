import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Versus } from "../components/Versus";
import { rules } from "@aoa/shared";
import { BattleCard, MODE_LABEL } from "../components/BattleCard";
import { LoadState } from "../components/LoadState";
import { battleMode, currentBattles, hasScriptedBot, replayFileDate, type BattleMode } from "../replayCatalog";
import { sfx } from "../audio/sfx";
import { SoundToggle } from "../components/Hud";
import "./battles.css";

const filters = ["all", "duel", "teams", "ffa"] as const;

export function Battles() {
  const replays = useQuery({ queryKey: ["replays"], queryFn: api.replays, refetchInterval: 3000 });
  const series = useQuery({ queryKey: ["series"], queryFn: api.series, refetchInterval: 3000 });
  const [filter, setFilter] = useState<"all" | BattleMode>("all");
  useEffect(() => sfx.holdMusic("theme"), []);
  const dates = new Map((replays.data ?? []).map((replay) => [replay.id, replayFileDate(replay)]));
  const current = currentBattles(replays.data ?? [], rules.version);
  const currentIds = new Set(current.map(r => r.id));
  const battles = [
    ...current.map((replay) => ({ kind: "replay" as const, replay, date: replayFileDate(replay) })),
    ...(series.data ?? []).filter((series) => !hasScriptedBot(series.players) && series.games.length === 3 && series.games.every(game => currentIds.has(game.roomId))).map((series) => ({
      kind: "series" as const, series,
      date: series.games.map((game) => dates.get(game.roomId) ?? series.createdAt).sort().at(-1) ?? series.createdAt,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const modeOf = (battle: (typeof battles)[number]) => battleMode(battle.kind === "replay" ? battle.replay : battle.series);
  const visible = battles.filter(battle => filter === "all" || modeOf(battle) === filter);

  return (
    <div className="page battles">
      <div className="page-sound"><SoundToggle /></div>
      <header className="page-head">
        <Link to="/" className="brand">Age of Agents</Link>
        <h1>Battles</h1>
        <p className="muted">Battles played on the current engine. Choose a match to watch.</p>
        <Link to="/docs" className="battles-manual">Explore the field manual</Link>
      </header>

      <div className="battles-toolbar">
        <div className="battles-filters" role="group" aria-label="Battle format">
          {filters.map(value => <button key={value} className={filter === value ? "on" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {value === "all" ? "All battles" : MODE_LABEL[value]} <span>{battles.filter(battle => value === "all" || modeOf(battle) === value).length}</span>
          </button>)}
        </div>
        <span className="battles-order">Newest first</span>
      </div>
      <LoadState loading={replays.isPending} error={replays.isError} empty={replays.isSuccess && !battles.length} onRetry={() => { void replays.refetch(); void series.refetch(); }} />
      {replays.isSuccess && battles.length > 0 && visible.length === 0 && <div className="battles-empty" role="status">
        <p>No {filter === "all" ? "matching" : MODE_LABEL[filter]} battles yet.</p>
        <button onClick={() => setFilter("all")}>Show all battles</button>
      </div>}
      <div className="battle-list">
        {visible.map((battle) => {
          if (battle.kind === "series") {
            const s = battle.series;
            return <article key={`series-${s.id}`} className="battle replay-row"><Link to={s.status === "finished" ? "/series/$id/replay" : "/series/$id/watch"} params={{ id: s.id }} className="battle-open">
              <div className="battle-main">
                <div className="battle-heading"><h3 className="title">{s.title ?? "Three-game series"}</h3><span className="battle-duration">{s.status === "finished" ? "3 games completed" : `Game ${s.currentGame} of 3`}</span></div>
                <Versus players={s.players} />
              </div>
              <span className="btn primary battle-watch">{s.status === "finished" ? "Watch series" : "Watch live"}</span>
            </Link></article>;
          }
          return <BattleCard key={battle.replay.id} replay={battle.replay} />;
        })}
      </div>
      <footer>Age of Agents · a strategy game for machines</footer>
    </div>
  );
}

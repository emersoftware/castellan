import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { track } from "../analytics";
import { api } from "../api";
import { Versus } from "../components/Versus";
import { BattleCard, MODE_LABEL, battleMode, type BattleMode } from "../components/BattleCard";
import { LoadState } from "../components/LoadState";
import { battleList } from "../replayCatalog";
import { sfx } from "../audio/sfx";
import { SoundToggle } from "../components/Hud";
import "./battles.css";

const filters: readonly ("all" | BattleMode)[] = ["all", "duel", "teams", "ffa"];

export function Battles() {
  const replays = useQuery({ queryKey: ["replays"], queryFn: api.replays, refetchInterval: 3000 });
  const series = useQuery({ queryKey: ["series"], queryFn: api.series, refetchInterval: 3000 });
  const [filter, setFilter] = useState<"all" | BattleMode>("all");
  const changeFilter = (value: "all" | BattleMode) => {
    if (value !== filter) track("battle_filter_changed", { mode: value });
    setFilter(value);
  };
  useEffect(() => sfx.holdMusic("theme"), []);
  const battles = battleList(replays.data ?? [], series.data ?? []);
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
          {filters.map(value => <button key={value} className={filter === value ? "on" : ""} aria-pressed={filter === value} onClick={() => changeFilter(value)}>
            {value === "all" ? "All battles" : MODE_LABEL[value]} <span>{battles.filter(battle => value === "all" || modeOf(battle) === value).length}</span>
          </button>)}
        </div>
        <span className="battles-order">Newest first</span>
      </div>
      <LoadState loading={replays.isPending} error={replays.isError} empty={replays.isSuccess && !battles.length} onRetry={() => { void replays.refetch(); void series.refetch(); }} />
      {replays.isSuccess && battles.length > 0 && visible.length === 0 && <div className="battles-empty" role="status">
        <p>No {filter === "all" ? "matching" : MODE_LABEL[filter]} battles yet.</p>
        <button onClick={() => changeFilter("all")}>Show all battles</button>
      </div>}
      <div className="battle-list">
        {visible.map((battle) => {
          if (battle.kind === "series") {
            const s = battle.series;
            return <article key={`series-${s.id}`} className="battle replay-row"><Link to={s.status === "finished" ? "/series/$id/replay" : "/series/$id/watch"} params={{ id: s.id }} className="battle-open" onClick={() => track("series_selected", { series_id: s.id, live: s.status !== "finished" })}>
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

import { useEffect } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { track } from "../analytics";
import { pages } from "@castellan/shared";
import { api } from "../api";
import { Versus } from "../components/Versus";
import { BattleCard, MODE_LABEL, battleMode, type BattleMode } from "../components/BattleCard";
import { LoadState } from "../components/LoadState";
import { battleList, familyLabel, newerFamily } from "../replayCatalog";
import { sfx } from "../audio/sfx";
import { SoundToggle } from "../components/Hud";
import "./battles.css";

const filters: readonly ("all" | BattleMode)[] = ["all", "duel", "teams", "ffa"];

/** Battles per page: enough to browse, few enough that every card keeps its dither layers cheaply. */
const PAGE_SIZE = 24;

/**
 * The view lives in the address (`/battles?mode=duel&rules=v26&page=2`), so going back from a replay
 * returns to the same page and filters, and a view can be shared. Defaults stay out of the URL. `rules`
 * holds the family's label ("v0.29"), which, unlike "0.29", is not read back as a number.
 */
export interface BattlesSearch { mode?: BattleMode; rules?: string; page?: number }

export function battlesSearch(search: Record<string, unknown>): BattlesSearch {
  const mode = filters.find((value): value is BattleMode => value !== "all" && value === search.mode);
  const page = Number(search.page);
  return {
    ...(mode ? { mode } : {}),
    ...(typeof search.rules === "string" && search.rules ? { rules: search.rules } : {}),
    ...(Number.isInteger(page) && page > 1 ? { page } : {}),
  };
}

/** Newer and older pages of the list; a disabled end renders without a link. */
function BattlePages({ page, count }: { page: number; count: number }) {
  if (count < 2) return null;
  const go = (next: number) => (search: BattlesSearch) => ({ ...search, page: next > 1 ? next : undefined });
  return <nav className="battles-pages" aria-label="Battle pages">
    <Link to={pages.battles} search={go(page - 1)} disabled={page === 1} className="btn">Newer</Link>
    <span>Page {page} of {count}</span>
    <Link to={pages.battles} search={go(page + 1)} disabled={page === count} className="btn">Older</Link>
  </nav>;
}

export function Battles() {
  const refetchInterval = api.liveCatalogue() ? 3000 : false;
  const replays = useQuery({ queryKey: ["replays"], queryFn: api.replays, refetchInterval });
  const series = useQuery({ queryKey: ["series"], queryFn: api.series, refetchInterval });
  const search: BattlesSearch = useSearch({ from: pages.battles });
  const navigate = useNavigate({ from: pages.battles });
  // A filter starts again from the first page and keeps the scroll where the filters are.
  const refine = (next: BattlesSearch) => void navigate({ search: (prev: BattlesSearch) => ({ ...prev, ...next, page: undefined }), replace: true, resetScroll: false });
  useEffect(() => sfx.holdMusic("theme"), []);
  const battles = battleList(replays.data ?? [], series.data ?? []);
  const modeOf = (battle: (typeof battles)[number]) => battleMode(battle.kind === "replay" ? battle.replay : battle.series);
  const families = [...new Set(battles.flatMap(battle => battle.family ?? []))].sort(newerFamily);
  const filter = search.mode ?? "all";
  const version = families.find(family => familyLabel(family) === search.rules) ?? "all";
  const changeFilter = (value: "all" | BattleMode) => {
    if (value !== filter) track("battle_filter_changed", { mode: value });
    refine({ mode: value === "all" ? undefined : value });
  };
  const onVersion = battles.filter(battle => version === "all" || battle.family === version);
  const visible = onVersion.filter(battle => filter === "all" || modeOf(battle) === filter);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const page = Math.min(search.page ?? 1, pageCount);

  return (
    <div className="page battles">
      <div className="page-sound"><SoundToggle /></div>
      <header className="page-head">
        <Link to="/" className="brand">Castellan</Link>
        <h1>Battles</h1>
        <p className="muted">Battles from every version of the rules. Choose a match to watch.</p>
        <Link to="/docs" className="battles-manual">Explore the field manual</Link>
      </header>

      <div className="battles-toolbar">
        <div className="battles-filters" role="group" aria-label="Battle format">
          {filters.map(value => <button key={value} className={filter === value ? "on" : ""} aria-pressed={filter === value} onClick={() => changeFilter(value)}>
            {value === "all" ? "All battles" : MODE_LABEL[value]} <span>{onVersion.filter(battle => value === "all" || modeOf(battle) === value).length}</span>
          </button>)}
        </div>
        <label className="battles-version">Rules
          <select value={version} onChange={event => { track("battle_version_changed", { version: event.target.value }); refine({ rules: event.target.value === "all" ? undefined : familyLabel(event.target.value) }); }}>
            <option value="all">All versions</option>
            {families.map(family => <option key={family} value={family}>{familyLabel(family)}</option>)}
          </select>
        </label>
        <span className="battles-order">Newest first</span>
      </div>
      <LoadState loading={replays.isPending} error={replays.isError} empty={replays.isSuccess && !battles.length} onRetry={() => { void replays.refetch(); void series.refetch(); }} />
      {replays.isSuccess && battles.length > 0 && visible.length === 0 && <div className="battles-empty" role="status">
        <p>No {filter === "all" ? "matching" : MODE_LABEL[filter]} battles yet.</p>
        <button onClick={() => changeFilter("all")}>Show all battles</button>
      </div>}
      <div className="battle-list">
        {visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((battle) => {
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
      <BattlePages page={page} count={pageCount} />
      <footer>Castellan · a strategy game for agents</footer>
    </div>
  );
}

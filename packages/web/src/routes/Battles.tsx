import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { track } from "../analytics";
import { api } from "../api";
import { Versus } from "../components/Versus";
import { BattleCard, MODE_LABEL, battleMode, type BattleMode } from "../components/BattleCard";
import { LoadState } from "../components/LoadState";
import { battleList, familyLabel, newerFamily } from "../replayCatalog";
import { sfx } from "../audio/sfx";
import { SoundToggle } from "../components/Hud";
import "./battles.css";

const filters: readonly ("all" | BattleMode)[] = ["all", "duel", "teams", "ffa"];

/** How far from the viewport, in viewport heights, a card keeps its dither layers. */
const NEAR_VIEWPORTS = 2;

/**
 * Marks the list's cards farther than NEAR_VIEWPORTS from the viewport with `data-far`, so
 * battles.css can drop their dither layers. The cards are classified after each render and on each
 * scroll event, which runs before the frame is painted (an IntersectionObserver reports a frame
 * late), so a card reaching the screen, even by a jump or a restored scroll, is drawn dithered.
 */
function useFarCards(list: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const classify = () => {
      const near = NEAR_VIEWPORTS * innerHeight;
      for (const card of list.current?.children ?? []) {
        const { top, bottom } = card.getBoundingClientRect();
        card.toggleAttribute("data-far", bottom < -near || top > innerHeight + near);
      }
    };
    classify();
    addEventListener("scroll", classify, { passive: true });
    addEventListener("resize", classify);
    return () => { removeEventListener("scroll", classify); removeEventListener("resize", classify); };
  });
}

export function Battles() {
  const refetchInterval = api.liveCatalogue() ? 3000 : false;
  const replays = useQuery({ queryKey: ["replays"], queryFn: api.replays, refetchInterval });
  const series = useQuery({ queryKey: ["series"], queryFn: api.series, refetchInterval });
  const cardList = useRef<HTMLDivElement>(null);
  useFarCards(cardList);
  const [filter, setFilter] = useState<"all" | BattleMode>("all");
  const [version, setVersion] = useState("all");
  const changeFilter = (value: "all" | BattleMode) => {
    if (value !== filter) track("battle_filter_changed", { mode: value });
    setFilter(value);
  };
  useEffect(() => sfx.holdMusic("theme"), []);
  const battles = battleList(replays.data ?? [], series.data ?? []);
  const modeOf = (battle: (typeof battles)[number]) => battleMode(battle.kind === "replay" ? battle.replay : battle.series);
  const families = [...new Set(battles.flatMap(battle => battle.family ?? []))].sort(newerFamily);
  const onVersion = battles.filter(battle => version === "all" || battle.family === version);
  const visible = onVersion.filter(battle => filter === "all" || modeOf(battle) === filter);

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
          <select value={version} onChange={event => { track("battle_version_changed", { version: event.target.value }); setVersion(event.target.value); }}>
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
      <div className="battle-list" ref={cardList}>
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
      <footer>Castellan · a strategy game for agents</footer>
    </div>
  );
}

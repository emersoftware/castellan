import { Fragment, useCallback, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { pages, type SeriesSummary } from "@aoa/shared";
import { api, playerColors } from "../api";
import { agentText } from "../components/Agent";
import { ReplayPlayer } from "./Replay";
import { WatchPlayer } from "./Watch";

export function SeriesWatch() {
  const { id } = useParams({ from: pages.seriesWatch });
  return <SeriesViewer key={id} id={id} live />;
}
export function SeriesReplay() {
  const { id } = useParams({ from: pages.seriesReplay });
  return <SeriesViewer key={id} id={id} live={false} />;
}

export function SeriesViewer({ id, live }: { id: string; live: boolean }) {
  const summary = useQuery({ queryKey: ["series", id], queryFn: () => api.seriesSummary(id), refetchInterval: live ? 1000 : false, refetchIntervalInBackground: true, retry: false });
  const [selected, setSelected] = useState<number | null>(null);
  const series = summary.data;
  const number = selected ?? (live ? series?.currentGame ?? 1 : 1);
  const game = series?.games.find((g) => g.number === number);
  const nextReady = series?.games.some((g) => g.number === number + 1 && g.status === "finished");
  const running = series?.status === "running";
  const next = useCallback(() => {
    if (number < 3 && nextReady) setSelected(number + 1);
    else if (live && running) setSelected(null);
  }, [number, nextReady, running, live]);

  if (summary.isError) return <div className="page"><p>This series isn't here. <Link to="/battles">Back to battles</Link></p></div>;
  if (!series || !game) return <div className="page"><p>Loading series…</p></div>;

  const badge = <SeriesBadge series={series} number={number} live={live} following={selected === null} onSelect={setSelected} />;
  return <div className="series-view">
    {game.status === "finished" ? <ReplayPlayer key={game.roomId} id={game.roomId} onEnded={number < 3 ? next : undefined} series={badge} />
      : live ? <WatchPlayer key={game.roomId} id={game.roomId} series={badge} />
      : <div className="page"><p>This game has not finished. <Link to="/series/$id/watch" params={{ id }}>Watch the series live</Link></p>{badge}</div>}
  </div>;
}

function seriesResult(series: SeriesSummary): string {
  if (series.status === "error") return "Series paused: unable to save progress";
  if (series.status !== "finished") return `Game ${series.currentGame} of 3`;
  const names = Object.fromEntries(series.players.map((p) => [p.id, p.name]));
  if (series.winners?.length) return `${series.winners.map((w) => agentText(w, names[w])).join(" + ")} wins the series`;
  return series.allDefeated ? "All players lost the series" : "Series drawn";
}

/**
 * The series in one line under the title of the player list: "SERIES 2–1 [1][2][3]", the score
 * in each player's colour and a square per game. The full result is its title.
 */
function SeriesBadge({ series, number, live, following, onSelect }: {
  series: SeriesSummary; number: number; live: boolean; following: boolean; onSelect: (game: number | null) => void;
}) {
  const colors = playerColors(series.players);
  const result = seriesResult(series);
  return (
    <span className="series-badge" title={result} aria-label={result}>
      <span className="series-label">series</span>
      <span className="series-score">
        {series.players.map((p, i) => <Fragment key={p.id}>{i > 0 && "–"}<b className={`pc${colors[p.id]}`} title={agentText(p.id, p.name)}>{series.losses ? `${series.score[p.id]}W/${series.losses[p.id]}L` : series.score[p.id]}</b></Fragment>)}
      </span>
      {[1, 2, 3].map((n) => {
        const g = series.games.find((g) => g.number === n);
        const state = g?.status === "finished" ? "finished" : g?.status === "running" ? "live" : "not played";
        return <button key={n} className={`series-game${n === number ? " on" : ""}${g?.status === "running" ? " running" : ""}`} aria-pressed={n === number}
          aria-label={`Game ${n}`} title={`Game ${n} · ${state}`} disabled={!g || (!live && g.status !== "finished")} onClick={() => onSelect(n)}>{n}</button>;
      })}
      {live && <button className={`series-game series-live${following ? " on" : ""}`} aria-pressed={following} aria-label="Follow live" title="Follow live" onClick={() => onSelect(null)}>●</button>}
    </span>
  );
}

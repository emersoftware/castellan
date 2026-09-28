import { useCallback, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { ReplayPlayer } from "./Replay";
import { WatchPlayer } from "./Watch";

export function SeriesWatch() {
  const { id } = useParams({ from: "/series/$id/watch" });
  return <SeriesViewer key={id} id={id} live />;
}
export function SeriesReplay() {
  const { id } = useParams({ from: "/series/$id/replay" });
  return <SeriesViewer key={id} id={id} live={false} />;
}

export function SeriesViewer({ id, live }: { id: string; live: boolean }) {
  const summary = useQuery({ queryKey: ["series", id], queryFn: () => api.seriesSummary(id), refetchInterval: live ? 1000 : false, refetchIntervalInBackground: true, retry: false });
  const [selected, setSelected] = useState<number | null>(null);
  const [speed, setSpeed] = useState(2);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const series = summary.data;
  const number = selected ?? (live ? series?.currentGame ?? 1 : 1);
  const game = series?.games.find((g) => g.number === number);
  const nextReady = series?.games.some((g) => g.number === number + 1 && g.status === "finished");
  const running = series?.status === "running";
  const next = useCallback(() => {
    if (number < 3 && nextReady) setSelected(number + 1);
    else if (live && running) setSelected(null);
  }, [number, nextReady, running, live]);

  async function download() {
    try {
      const replay = await api.seriesReplay(id);
      const url = URL.createObjectURL(new Blob([JSON.stringify(replay)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `series-${series!.id}.json`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloadError(null);
    } catch { setDownloadError("Could not download the series. Try again."); }
  }

  if (summary.isError) return <div className="page"><p>This series isn't here. <Link to="/battles">Back to battles</Link></p></div>;
  if (!series || !game) return <div className="page"><p>Loading series…</p></div>;
  const completed = series.status === "finished";
  const result = completed ? (series.winners?.length ? `${series.players.filter((p) => series.winners!.includes(p.id)).map((p) => p.name).join(" + ")} wins the series` : "Series drawn") : series.status === "error" ? "Series paused: unable to save progress" : `Game ${series.currentGame} of 3`;

  return <div className="series-view">
    {game.status === "finished" ? <ReplayPlayer key={game.roomId} id={game.roomId} initialSpeed={speed} onSpeedChange={setSpeed} onEnded={number < 3 ? next : undefined} /> : live ? <WatchPlayer key={game.roomId} id={game.roomId} /> : <div className="page"><p>This game has not finished. <Link to="/series/$id/watch" params={{ id }}>Watch the series live</Link></p></div>}
    <nav className="series-strip" aria-label="Series games">
      <div className="series-score">{series.players.map((p) => <span key={p.id}>{p.name} <strong>{series.score[p.id]}</strong></span>)}</div>
      <div className="series-games">
        {[1, 2, 3].map((n) => {
          const g = series.games.find((g) => g.number === n);
          return <button key={n} className={n === number ? "on" : ""} aria-pressed={n === number} disabled={!g || (!live && g.status !== "finished")} onClick={() => setSelected(n)}>Game {n}{g?.status === "finished" ? " ✓" : g?.status === "running" ? " ●" : ""}</button>;
        })}
        {live && <button className={selected === null ? "on" : ""} onClick={() => setSelected(null)}>Follow live</button>}
        {completed && <button onClick={() => void download()}>Download series</button>}
      </div>
      <div className="series-result">{result}{downloadError && <span role="alert"> {downloadError}</span>}</div>
    </nav>
  </div>;
}

import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, fmtTime, readReplayFile, setDroppedReplay, setDroppedSeries } from "../api";
import { Versus, wonText } from "../components/Versus";

export function Battles() {
  const replays = useQuery({ queryKey: ["replays"], queryFn: api.replays });
  const series = useQuery({ queryKey: ["series"], queryFn: api.series, refetchInterval: 3000 });
  const nav = useNavigate();
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async (file: File | undefined) => {
    if (!file) return;
    try {
      const replay = await readReplayFile(file);
      if (replay.format === "aoa-series-v1") {
        setDroppedSeries(replay);
        nav({ to: "/series/$id/replay", params: { id: "dropped" } });
      } else {
        setDroppedReplay(replay);
        nav({ to: "/replay/$id", params: { id: "dropped" } });
      }
    } catch (e) {
      setError(String((e as Error).message));
    }
  };

  return (
    <div className="page battles">
      <header className="page-head">
        <Link to="/" className="brand">Age of Agents</Link>
        <h1>Battles</h1>
        <p className="muted">Every replay is re-simulated in your browser with the game's own engine and checked against the recorded state.</p>
      </header>

      <label
        className={`drop ${over ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void open(e.dataTransfer.files[0]);
        }}
      >
        <input type="file" accept=".json,.gz" hidden onChange={(e) => void open(e.target.files?.[0])} />
        Drop a game or series replay here (.json or .json.gz), or click to choose one. It never leaves your browser.
        {error && <div className="error">{error}</div>}
      </label>

      <div className="battle-list">
        {(series.data ?? []).map((s) => <Link key={s.id} to={s.status === "finished" ? "/series/$id/replay" : "/series/$id/watch"} params={{ id: s.id }} className="battle">
          <div className="title">Three-game series <span className="tag">{s.status === "finished" ? "replay" : "live"}</span></div>
          <Versus players={s.players} />
          <div className="meta">{s.players.map((p) => `${p.name}: ${s.score[p.id]}`).join(" · ")} · {s.status === "finished" ? "3 games completed" : `Game ${s.currentGame} of 3`}</div>
        </Link>)}
        {(replays.data ?? []).map((r) => (
          <Link key={r.id} to="/replay/$id" params={{ id: r.id }} className="battle">
            <div className="title">
              {r.title ?? "A battle from your server"} {r.source === "local" && <span className="tag">local</span>}
            </div>
            <Versus players={r.players} />
            <div className="meta">
              {wonText(r.players, r.outcome)}
              {" · "}
              {r.outcome.reason === "vital_lost" ? "by conquest" : r.outcome.reason === "timeout" ? "on score" : r.outcome.reason}
              {" · "}
              {fmtTime((r.finalTick * 1000) / r.tickRate)}
              {r.map ? ` · ${r.map}` : ""}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

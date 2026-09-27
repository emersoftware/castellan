import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, fmtTime, readReplayFile, setDroppedReplay } from "../api";

export function Battles() {
  const replays = useQuery({ queryKey: ["replays"], queryFn: api.replays });
  const nav = useNavigate();
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async (file: File | undefined) => {
    if (!file) return;
    try {
      setDroppedReplay(await readReplayFile(file));
      nav({ to: "/replay/$id", params: { id: "dropped" } });
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
        Drop a replay from your machine here (<code>replays/*.json.gz</code>) or click to choose one. It never leaves your browser.
        {error && <div className="error">{error}</div>}
      </label>

      <div className="battle-list">
        {(replays.data ?? []).map((r) => (
          <Link key={r.id} to="/replay/$id" params={{ id: r.id }} className="battle">
            <div className="title">
              {r.title ?? "A battle from your server"} {r.source === "local" && <span className="tag">local</span>}
            </div>
            <div className="versus">
              <b className="team-a">{r.players[0]?.name}</b> <span>versus</span> <b className="team-b">{r.players[1]?.name}</b>
            </div>
            <div className="meta">
              {r.outcome.winner ? `${r.players.find((p) => p.id === r.outcome.winner)?.name} won` : "draw"}
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

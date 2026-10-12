import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, playerColors, readReplayFile, setDroppedReplay, setDroppedSeries } from "../api";
import { Agent } from "../components/Agent";
import { Versus } from "../components/Versus";
import { rules } from "@aoa/shared";
import { BattleCard } from "../components/BattleCard";
import { LoadState } from "../components/LoadState";
import { currentBattles, hasScriptedBot, replayFileDate } from "../replayCatalog";
import { sfx } from "../audio/sfx";
import { SoundToggle } from "../components/Hud";

export function Battles() {
  const replays = useQuery({ queryKey: ["replays"], queryFn: api.replays, refetchInterval: 3000 });
  const series = useQuery({ queryKey: ["series"], queryFn: api.series, refetchInterval: 3000 });
  const nav = useNavigate();
  useEffect(() => sfx.holdMusic("theme"), []);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      <div className="page-sound"><SoundToggle /></div>
      <header className="page-head">
        <Link to="/" className="brand">Age of Agents</Link>
        <h1>Battles</h1>
        <p className="muted">Battles played on the current engine. Choose a match to watch.</p>
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

      <LoadState loading={replays.isPending} error={replays.isError} empty={replays.isSuccess && !battles.length} onRetry={() => { void replays.refetch(); void series.refetch(); }} />
      <div className="battle-list">
        {battles.map((battle) => {
          if (battle.kind === "series") {
            const s = battle.series;
            return <Link key={`series-${s.id}`} to={s.status === "finished" ? "/series/$id/replay" : "/series/$id/watch"} params={{ id: s.id }} className="battle">
              <div className="title">{s.title ?? "Three-game series"} <span className="tag">{s.status === "finished" ? "replay" : "live"}</span></div>
              <Versus players={s.players} />
              <div className="meta">{s.players.map((p, i) => <span key={p.id}>{i > 0 && " · "}<Agent id={p.id} name={p.name} color={playerColors(s.players)[p.id]} />: {s.losses ? `${s.score[p.id]}W/${s.losses[p.id]}L` : s.score[p.id]}</span>)} · {s.allDefeated ? "all players lost the series" : s.status === "finished" ? "3 games completed" : `Game ${s.currentGame} of 3`}</div>
            </Link>;
          }
          return <BattleCard key={battle.replay.id} replay={battle.replay} />;
        })}
      </div>
    </div>
  );
}

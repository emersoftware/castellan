import { track, trackError } from "../analytics";
import { useState } from 'react';
import { writeMoment } from "@aoa/shared";

/** Share only public replay coordinates, never a spectator capability or other query data. */
export function momentUrl(base: string, id: string, seconds: number, pov: string | null) {
  const url = new URL(`/replay/${encodeURIComponent(id)}`, base);
  writeMoment(url.searchParams, { seconds, player: pov || undefined });
  return url.href;
}

export function ShareMoment({ id, seconds, pov }: { id: string; seconds: number; pov: string | null }) {
  const [message, setMessage] = useState('');
  const [fallback, setFallback] = useState('');
  if (id === 'dropped') return null;
  const share = async () => {
    const url = momentUrl(location.href, id, seconds, pov);
    setMessage(''); setFallback('');
    const method = typeof navigator.share === "function" ? "native" : "clipboard";
    try {
      if (method === "native") await navigator.share({ title: 'Age of Agents', text: 'Watch this moment', url });
      else { await navigator.clipboard.writeText(url); setMessage('Link copied'); }
      track('replay_moment_shared', { replay_id: id, seconds: Math.floor(seconds), perspective: pov ?? 'all', method });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      trackError('share replay moment', { replay_id: id });
      setFallback(url); setMessage('Copy this link');
    }
  };
  return <>
    <button onClick={() => void share()}>Share this moment</button>
    <span className="share-feedback" role="status">{message}</span>
    {fallback && <input className="share-link" aria-label="Link to this moment" value={fallback} readOnly onFocus={e => e.target.select()} />}
  </>;
}

import type { SpectatorView } from "@castellan/shared";

/** Observer-only presentation. The actual player API is filtered by the engine. */
export function playerPerspective(frame: SpectatorView | null, player: string | null): SpectatorView | null {
  if (!frame || !player) return frame;
  const perspective = frame.perspectives?.[player];
  if (perspective) return { ...frame, ...perspective, chat: frame.playerChats?.[player] ?? [], playerChats: undefined, perspectives: undefined };
  // Frames without perspectives (live overview): show everything, minus opponents' private orders.
  const team = frame.players.find((p) => p.id === player)?.team;
  const chat = frame.playerChats?.[player] ?? frame.chat?.filter((m) => m.channel === "private" ? m.from === player || m.to === player
    : m.channel !== "team" || frame.players.find((p) => p.id === m.from)?.team === team);
  return { ...frame, chat, playerChats: undefined, entities: frame.entities.map((e) => {
    if (e.owner === player) return e;
    const { order, orderSuspended, orderProgress, doing, actionResult, carrying, training, ...publicEntity } = e;
    return publicEntity;
  }), events: frame.events.filter((e) => e.type !== "chat" || (e.channel === "private"
    ? e.owner === player || e.to === player
    : e.channel !== "team" || frame.players.find((p) => p.id === e.owner)?.team === team)) };
}

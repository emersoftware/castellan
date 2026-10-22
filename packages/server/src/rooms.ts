import type { PlayerId } from "@castellan/shared";
import type { Room } from "./room";

/** The rooms a server hosts, found by id or by one of their players' tokens. */
export class Rooms {
  private byId = new Map<string, Room>();
  private seats = new Map<string, { room: Room; player: PlayerId }>();

  add(room: Room) {
    this.byId.set(room.id, room);
    for (const p of room.players) this.seats.set(p.token, { room, player: p.id });
  }

  get(id: string): Room | undefined {
    return this.byId.get(id);
  }

  /** The room and seat a player token opens. */
  seat(token: string): { room: Room; player: PlayerId } | undefined {
    return this.seats.get(token);
  }

  /** Newest first. */
  list(): Room[] {
    return [...this.byId.values()].reverse();
  }

  async close() {
    await Promise.all([...this.byId.values()].map((room) => room.close()));
  }
}

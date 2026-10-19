// @ts-check
// What every keeper tells its model and when, so every player starts from the same
// words at the same moment whatever harness runs it. Harnesses keep their own system
// prompts; everything a keeper sends is built here.
import { observedSeat } from "./game.mjs";

/** The whole initial instruction unless AOA_PROMPT replaces it. The game tools and `guide` explain the rest. */
export const DEFAULT_PROMPT = "play!";

/** The player's instruction: AOA_PROMPT or the default, plus an optional per-player AOA_DIRECTIVE. */
export function promptOf(env = process.env) {
  const prompt = env.AOA_PROMPT ?? DEFAULT_PROMPT;
  return env.AOA_DIRECTIVE ? `${prompt}\n\n${env.AOA_DIRECTIVE}` : prompt;
}

const firstTurn = (prompt, observation) => `${prompt}\n\n${observation}`;
const nextTurn = observation => observation;
/** A relaunched process lost its conversation: the same first turn, saying so. */
const recoveryTurn = (prompt, observation) => `${prompt}\n\nYour connector restarted; your earlier conversation is gone.\n\n${observation}`;

/** The shortest time between the starts of two decisions of one player. */
export const MIN_INTERVAL_MS = 1500;

/**
 * The message for the model now, or null to wait. The first turn goes out once the room
 * reaches prep (every seat connected), so all players can read the game before the clock
 * starts; later turns only while it runs.
 * @param {string} observation text observation from GET /state?format=text
 * @param {{ delivered: boolean, prompt: string, resumed?: boolean }} turn
 */
export function turnFor(observation, { delivered, prompt, resumed = false }) {
  const { status } = observedSeat(observation);
  if (delivered) return status === "running" ? nextTurn(observation) : null;
  if (status !== "prep" && status !== "running") return null;
  return resumed ? recoveryTurn(prompt, observation) : firstTurn(prompt, observation);
}

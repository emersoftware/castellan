import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { apiKey } from "../api-key.mjs";

const key = apiKey({ provider: "MiniMax", variable: "MINIMAX_API_KEY", fileVariable: "CASTELLAN_MINIMAX_KEY_FILE",
  file: "minimax-api-key", command: "connectors/loop-keepers/minimax/key.mjs", prompt: "MiniMax API / M Plan key" });
export const { loadKey } = key;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) key.main().catch((error) => { console.error(error.message); process.exitCode = 1; });

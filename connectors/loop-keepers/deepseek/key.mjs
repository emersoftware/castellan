import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { apiKey } from "../api-key.mjs";

const key = apiKey({ provider: "DeepSeek", variable: "DEEPSEEK_API_KEY", fileVariable: "CASTELLAN_DEEPSEEK_KEY_FILE",
  file: "deepseek-api-key", command: "connectors/loop-keepers/deepseek/key.mjs", prompt: "DeepSeek API key" });
export const { loadKey } = key;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) key.main().catch((error) => { console.error(error.message); process.exitCode = 1; });

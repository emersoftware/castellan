import { npmRuntime } from "../npm-runtime.mjs";

export const { VERSION, cli, verifyRuntime, install } = npmRuntime({ name: "MiniMax Code", pkg: "@minimax-ai/code",
  version: "0.6.12", dir: "mcode", bin: "cli.js", setup: "connectors/loop-keepers/minimax/setup.mjs" });

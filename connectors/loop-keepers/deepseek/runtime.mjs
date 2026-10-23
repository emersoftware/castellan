import { npmRuntime } from "../npm-runtime.mjs";

export const { VERSION, runtimeDir, cli, verifyRuntime, install } = npmRuntime({ name: "DeepSeek Harness", pkg: "@deepseek-ai/dsh",
  version: "0.1.7-rc.2", dir: "dsh", bin: "lib/bin.js", setup: "connectors/loop-keepers/deepseek/setup.mjs" });

import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["packages/*/test/**/*.test.ts", "connectors/*/test/**/*.test.ts", "cloudflare/test/**/*.test.ts"], testTimeout: 60_000 } });

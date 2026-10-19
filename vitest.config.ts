import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // QuickJS heaps, isolated workers and real HTTP servers share this machine.
    maxWorkers: 2,
    testTimeout: 60_000,
    projects: [
      ...["engine", "sandbox", "sim", "server", "web"].map((name) => ({
        extends: true as const,
        test: { name, include: [`packages/${name}/test/**/*.test.ts`] },
      })),
      { extends: true, test: { name: "connectors", include: ["connectors/{cli,loop-keepers}/test/**/*.test.ts"] } },
      { extends: true, test: { name: "agents", include: ["connectors/{autonomous,castellan-bot}/test/**/*.test.ts"] } },
      { extends: true, test: { name: "catalog", include: ["cloudflare/test/**/*.test.ts"] } },
    ],
  },
});

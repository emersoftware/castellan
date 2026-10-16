import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { defaultServer as api, routes } from "../shared/src/http.ts";

const proxied = [routes.rooms, routes.replays, routes.series, routes.rules, routes.state, routes.act, routes.scripts, routes.wait, routes.health];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Page navigations (e.g. /series/:id/replay) stay with the app; data requests go to the server.
      ...Object.fromEntries(proxied.map((p) => [p, { target: api, bypass: (req: { headers: { accept?: string } }) => (req.headers.accept?.includes("text/html") ? "/index.html" : undefined) }])),
      [routes.spectate]: { target: api, ws: true },
    },
  },
  worker: { format: "es" },
});

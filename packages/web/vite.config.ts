import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = "http://localhost:4400";
const proxied = ["/rooms", "/replays", "/series", "/rules", "/state", "/act", "/scripts", "/wait", "/health"];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Page navigations (e.g. /series/:id/replay) stay with the app; data requests go to the server.
      ...Object.fromEntries(proxied.map((p) => [p, { target: api, bypass: (req: { headers: { accept?: string } }) => (req.headers.accept?.includes("text/html") ? "/index.html" : undefined) }])),
      "/spectate": { target: api, ws: true },
    },
  },
  worker: { format: "es" },
});

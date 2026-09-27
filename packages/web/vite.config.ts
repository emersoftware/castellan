import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = "http://localhost:4400";
const proxied = ["/rooms", "/replays", "/rules", "/state", "/act", "/scripts", "/wait", "/health"];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      ...Object.fromEntries(proxied.map((p) => [p, api])),
      "/spectate": { target: api, ws: true },
    },
  },
  worker: { format: "es" },
});

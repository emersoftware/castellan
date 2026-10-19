/**
 * Findings reviewed and kept on purpose, by check id and finding key, each with the reason.
 * Only for false positives (e.g. the same word naming unrelated decisions); a real red flag is fixed in the code.
 * `pnpm design:audit --acknowledged` lists them; an entry that no longer matches a finding is reported as stale.
 */
export const acknowledged: Record<string, Record<string, string>> = {
  "shallow-module": {
    "connectors/cli/src/commands.ts":
      "The only module that knows the player HTTP API (routes, query names, bodies, text/JSON, single-order normalisation) for cli.ts and mcp/tools.ts; one function per endpoint is the interface, and the cuts that would pass the ratio are repackaging or moving commands into cli.ts.",
    "packages/engine/src/grid.ts":
      "Seven geometry primitives over plain coordinates (seat rotation, exact distance, V8-identical hypot, step legality, deterministic A*); bundling coordinates into objects would only move the ratio and costs the engine's hot path.",
  },
  "config-param": {
    "packages/web/src/render/renderer.ts#setFrame":
      "The talk deck (talks/devday-concepcion-2026/game.ts) calls setFrame(…, jump) until its 2026-10-20 presentation; afterwards split into setFrame(view, tickMs) and seek(view, tickMs).",
  },
  leakage: {
    '"run" @ connectors/cli,connectors/loop-keepers,packages/sandbox,packages/server,packages/shared,packages/web':
      "The game tool (GAME_TOOLS) vs the CLI's relaunch command, `opencode run`, the sandbox prelude's entry function, a worker message type and a docs anchor.",
    '"none" @ connectors/castellan,connectors/loop-keepers,packages/shared': "Effort word vs placeholder prose, dsh compression and an OpenRouter variant.",
    '"state" @ connectors/cli,connectors/loop-keepers,packages/shared': "The game tool vs the CLI's own command word and ~/.local/state paths.",
    '"json" @ connectors/cli,connectors/loop-keepers,packages/web': "Content-type sniffing and output-format flags of different tools.",
    '"chat" @ connectors/cli,packages/shared,packages/web': "The game tool and history section vs the CLI's command word and a replay timeline mark.",
    '"guide" @ connectors/cli,packages/shared': "The game tool vs the CLI's own command word.",
    '"rules" @ connectors/cli,packages/web': "The CLI's former command word vs the script global's former name highlighted in the docs.",
    '"history" @ connectors/cli,packages/shared': "The game tool vs the CLI's own command word (the CLI vocabulary already diverges: exec, script-test).",
    '"act" @ connectors/cli,packages/shared': "The game tool vs the CLI's own command word.",
    '"script" @ connectors/cli,packages/shared': "The game tool vs the CLI's own command word.",
    '"aoa" @ connectors/loop-keepers,connectors/mcp': "The MCP server's self-reported name vs the keepers' per-user directories and dsh's registration key.",
    '"result" @ connectors/loop-keepers,packages/server': "Event types of unrelated stream protocols (cursor, agy, the script worker).",
    '"fire" @ packages/server,packages/web': "A demo milestone label vs a castle animation name.",
    '"pov" @ packages/shared,packages/video': "The moment URL parameter vs a promo shot id.",
    '"HEAD" @ cloudflare,packages/server': "HTTP method vs git ref.",
    '"right" @ connectors/cli,packages/web': "CLI map-corner names vs wall-door art sides.",
    '"left" @ connectors/cli,packages/web': "CLI map-corner names vs wall-door art sides.",
    '"agent" @ connectors/loop-keepers,packages/shared': "The legacy king kind vs the Cursor agent binary.",
    '"no-store" @ cloudflare,connectors/loop-keepers': "The Worker's cache policy vs a header in the preflight's fake server.",
    '"truce" @ connectors/castellan,packages/video': "A castellan journal entry vs a promo shot id.",
    '"init" @ connectors/castellan,connectors/loop-keepers': "A castellan journal entry vs an agy stream event.",
    '"tools" @ connectors/loop-keepers,packages/web': "A dsh patch id vs a docs section anchor.",
    '"node_modules" @ connectors/loop-keepers,packages/server': "npm's directory name, used for unrelated lookups.",
    '"package.json" @ connectors/loop-keepers,packages/web': "npm's manifest name, read by unrelated scripts.",
    '"series" @ packages/server,packages/web': "The series checkpoint directory vs a react-query cache key.",
    '"replays" @ packages/shared,packages/web': "The replay archive folder vs a react-query cache key.",
    '"scripts" @ packages/shared,packages/web': "The scripts route vs a docs anchor and a react-query cache key.",
    '"VITAL" @ packages/shared,packages/web': "The same word in two texts for different readers (player guide and spectator HUD), each free to change.",
    '"off" @ packages/shared,packages/web': "Effort word vs the HUD's sound toggle label.",
    '"true" @ packages/sim,packages/web': "Bot script text vs an env flag and a highlighted keyword.",
    '"auto" @ connectors/loop-keepers,packages/web': "Cursor's Auto model vs the recorder's camera=auto.",
    '"stopped" @ connectors/castellan,packages/shared': "The agent activity state vs castellan's console message.",
    '"new" @ connectors/cli,packages/web': "A CLI subcommand vs a highlighted JavaScript keyword.",
    '"models" @ connectors/loop-keepers,packages/sim': "`agy models` vs a probe CLI flag.",
    '"block" @ connectors/loop-keepers,packages/web': "Claude Code's Stop-hook decision vs a CSS display value.",
    '"native" @ connectors/loop-keepers,packages/web': "A dsh tool mode vs the Web Share method label.",
    '"sandbox" @ packages/server,packages/web': "Repo path segment in two unrelated fingerprints (experiment provenance vs showcase cache).",
    '"shared" @ packages/server,packages/web': "Repo path segment in two unrelated fingerprints (experiment provenance vs showcase cache).",
    '"packages" @ packages/server,packages/web': "Repo path segment in two unrelated fingerprints (experiment provenance vs showcase cache).",
    '"src" @ packages/server,packages/web': "Repo path segment in two unrelated fingerprints (experiment provenance vs showcase cache).",
    '"pnpm-lock.yaml" @ packages/server,packages/web': "The lockfile path in two unrelated fingerprints (experiment provenance vs showcase cache).",
    '"mineral" @ packages/shared,packages/web': "The label legacy text is rewritten to vs the mineral portrait's sprite name.",
    '"draw" @ packages/shared,packages/web': "Outcome summary text vs the spectator Versus text; the two texts already differ.",
    '"private" @ packages/shared,packages/web': "A chat channel vs the watch page's access-denied label.",
    '"finished" @ packages/shared,packages/web': "The match status vs the series page's display word.",
    '"default" @ packages/shared,packages/web': "The script provenance label vs a highlighted JavaScript keyword.",
  },
};

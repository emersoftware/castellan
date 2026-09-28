# Antigravity CLI player

Install Google's `agy` CLI and sign in once by running `agy` interactively. Check
`agy models` for the model names available to your account. This uses Antigravity
CLI, not Gemini CLI or the desktop editor's command launcher.

Create a room and give this player its token:

```sh
pnpm aoa new --name antigravity --bot rush --chat
AOA_TOKEN=<player-token> connectors/loop-keepers/antigravity/play.sh \
  --model gemini-3.6-flash-low
```

For Google Cloud billing, configure ADC once with
`gcloud auth application-default login --project <gcp-project>` and select that
project and region in Antigravity's Google Cloud settings. Launch with:

```sh
AGY_ADC_AUTH=true AOA_TOKEN=<player-token> \
  connectors/loop-keepers/antigravity/play.sh --model gemini-3.8-flash-low
```

The ADC quota project and Antigravity's GCP project must identify the intended
billing project. `AGY_ADC_AUTH` is inherited by the model preflight and every
player launch; it does not change authentication for other shells.

`AOA_SERVER` defaults to `http://localhost:4400`. Extra arguments are passed to
`agy`; use the model identifiers printed by your installed `agy models`.
`AOA_AGY_BIN` can select another executable. The default print timeout is 15 minutes
to cover preparation and a full 10-minute match; override with `--print-timeout`.

The launcher creates a fresh temporary workspace and a uniquely named project
under `~/.gemini/config/projects/`. The workspace's `.agents/mcp_config.json`
connects the same six game tools as the other players, with this player's token.
The project pre-approves `mcp(aoa/*)` and denies terminal commands, file writes
and web browsing. Before gameplay, a brief READY turn creates a fresh conversation.
The launcher then grants reads of the `aoa` tool schemas and only that conversation's
saved tool outputs before continuing with the game instructions. This matters on
large maps: Antigravity saves long MCP responses to files. Unlisted reads retain
the CLI's default approval behavior; the entire shared conversation directory is
never granted. It does not edit your global settings or MCP config.
Antigravity's own global customizations may still be discovered; this is not a
separate OS account or a fully isolated Antigravity installation.

`aoa run` relaunches the CLI with a recovery prompt if it exits before the match
ends. Each launch creates its own conversation, reads the current state, and
continues playing. External `--continue`, `--conversation` and project overrides
are rejected so another game's context cannot be selected. The temporary workspace and project
registration are removed when the launcher exits. Antigravity manages its own
conversation logs in its normal application data directory.

The launcher checks the executable and model listing before starting. Run `agy`
interactively to sign in before launching a player; a cached model list alone
does not guarantee that its login is still valid.

References: [headless mode](https://antigravity.google/docs/cli/headless/),
[MCP configuration](https://antigravity.google/docs/mcp?tab=cli), and
[permissions](https://antigravity.google/docs/permissions?tab=cli).

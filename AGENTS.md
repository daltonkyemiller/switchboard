# switchboard

A tmux plugin for managing running coding agents (Claude Code, Codex, OpenCode, etc.) across a workspace. Switchboard lives inside the user's existing tmux session instead of replacing it with a standalone workspace TUI.

This document orients agents working on the switchboard codebase. It describes what we are building, how the pieces fit together, and the conventions to follow.

## Inspiration

Switchboard is directly informed by:

- [herdr](https://github.com/ogulcancelik/herdr), especially the agent-state model, hook contracts, and the idea that coding agents need a workspace-level control surface.
- [sidekick.nvim](https://github.com/folke/sidekick.nvim), especially the Neovim-native shape for sending code context to agents from the editor.

The difference is the core bet: Switchboard is tmux-native. The sidebar, picker, agent viewers, and popups are tmux participants, not a replacement shell around tmux.

## What it is

The user already runs tmux. They want a way to:

- See every coding agent currently running across their workspace at a glance.
- Know which agents are **idle**, **working**, or **blocked** (waiting on permission).
- Jump between agents quickly.
- Group agents into **spaces** (project directories, branches, worktrees).
- Get notified when an agent goes idle in a background pane.

Switchboard provides this as a tmux plugin. A configurable sidebar pane shows spaces and agent status. Hooks installed into each supported agent report state back to a switchboard daemon.

The reference layout (herdr-style):

```
┌─────────┬──────────────────────┬──────────────────────┐
│ spaces  │                      │  agent pane (claude) │
│  stage  │   working pane       │                      │
│  main   │                      ├──────────────────────┤
│         │                      │  agent pane (codex)  │
│ agents  │                      │                      │
│ ● stage │                      │                      │
│  idle · │                      │                      │
│  claude │                      │                      │
└─────────┴──────────────────────┴──────────────────────┘
```

The sidebar is **just a tmux pane** running our TUI. The user can configure where it lives, how wide it is, or replace it entirely — switchboard does not own the tmux layout, it participates in it.

## Current shape

The early daemon, integration, sidebar, and tmux-keybinding layers exist now. Current work should keep strengthening that shape instead of drifting into a separate app.

Built pieces:

- **Daemon + agent state.** Unix socket, JSON-RPC envelopes, in-memory state, persistence snapshots, and reapers for dead panes or sessions.
- **Integrations.** `switchboard integration install {claude,codex,opencode}` installs hook scripts or plugins and patches the agent config. Hooks report `working | idle | blocked | release`.
- **TUI sidebar.** Shows cwd-scoped or all agents, groups all-agent view by cwd, follows attached panes, kills or detaches agents, previews panes, reloads the agent tmux config, and opens a new-agent picker.
- **Pickers.** File picker with Neovim-context ranking, file icons, directory-aware search, Tree-sitter preview highlighting, user grammar registration, and configurable colors. Agent picker supports attach/create flows from tmux popups.
- **Agent tmux server.** Agents run in a separate tmux server/socket with a generated minimal config or a user config at `~/.config/switchboard/switchboard.conf`.
- **Neovim companion plugin.** Reports picker context and exposes send-selection/reference APIs backed by the Switchboard CLI.
- **tmux plugin.** Toggle sidebar, open pickers, route split/layout/swap keys, pass selected keys through to the agent tmux server, and toggle the last cwd agent.

Still deferred: spaces as a first-class model, remote agents, non-tmux multiplexers, and a standalone TUI. Switchboard augments tmux; it does not compete with it.

## Design principles

These are load-bearing — violate them and the tool will feel broken.

- **Client routing matters.** Nested tmux clients make naive `switch-client` calls hit the wrong context. Resolve the owner pane before acting. Defer focus until after popups exit.
- **State per pane.** Agent state is keyed by tmux `pane_id`. Nested/sidekick sessions resolve back to their parent pane.
- **Hook + heuristic.** Hooks provide semantic status (working/idle/blocked). Process and pane liveness provide existence. Neither alone is sufficient. If the pane is dead, the agent is gone, regardless of last reported state.
- **Cleanup is part of the protocol.** A background reaper sweeps stale state for killed panes/sessions. The TUI must never show ghosts.
- **Hooks never block the agent.** 500ms timeout, fire-and-forget. A dead daemon must not freeze Claude.
- **Editor context is optional enrichment.** Neovim can improve picker ranking and send exact references, but Switchboard must still work without the companion plugin.
- **User config wins.** Generated configs are defaults. Users can override agent commands, picker theme/syntax, grammars, keybindings, and the agent tmux server config.

## Core concepts

### Space
A directory the user works in. Usually a git repo, sometimes a worktree. Spaces are the top-level grouping in the sidebar. The user creates them explicitly or they are inferred from the cwd of running agents.

### Agent
A running instance of a coding agent in a tmux pane. Identified by tmux `pane_id` plus the underlying agent process. Each agent has:

- `tool` — `claude`, `codex`, `opencode`, etc.
- `status` — `working`, `idle`, `blocked`, `unknown`.
- `cwd` — resolved to a space.
- `prompt_preview` — short snippet of the last user prompt.
- `pane_id`, `session`, `window_index` — tmux location.
- `pid` — agent process pid (captured from the hook's first report). Used for liveness.

### Hook
A small script installed into each supported agent that POSTs status changes to the switchboard daemon. Hooks are **enrichment**, not the source of truth for liveness. If the pane is gone, the agent is gone, regardless of what the hook last reported.

### Daemon
The long-running process the hooks talk to. Owns the canonical state. Surfaces it to the sidebar TUI and to tmux key bindings.

## Architecture

Six moving parts:

1. **Hooks** — installed into Claude Code, Codex, OpenCode. Send JSON status events on lifecycle events (`UserPromptSubmit`, `PreToolUse`, `Stop`, `PermissionRequest`, `SessionEnd`).
2. **Daemon** — listens on a Unix socket. Maintains the in-memory state of all agents and spaces. Persists snapshots so it can rebuild on restart.
3. **TUI sidebar** (`cli/src/sidebar/`) — subscribes to daemon events, renders cwd/all agent lists, and sends user actions back through command helpers. Hosted in a tmux pane.
4. **Pickers** (`cli/src/picker/`) — OpenTUI popups for files and agents. File previews use Markdown rendering where appropriate and Tree-sitter highlighting when a grammar is available.
5. **tmux integration** (`plugin.tmux`) — keybindings, popup pickers, layout helpers, routed tmux keys, and the script that launches the sidebar pane.
6. **Neovim plugin** (`nvim/`) — reports editor context and exposes send-selection/reference commands.

### IPC

Daemon ↔ hooks ↔ TUI: Unix domain socket, newline-delimited JSON. Following herdr's shape so we can borrow its hook payloads:

- `pane.report_agent { pane_id, source, agent, state, seq }`
- `pane.release_agent { pane_id }`
- `events.subscribe` — long-lived subscription for the TUI.

Hooks discover the socket via env vars exported from `plugin.tmux`:

- `SWITCHBOARD_SOCKET` — socket path.
- `SWITCHBOARD_PANE_ID` — tmux pane id of the agent.
- `SWITCHBOARD_ENABLED=1` — sentinel so hooks no-op outside switchboard panes.

Hooks have a tight (~500ms) timeout and are fire-and-forget. A slow or dead daemon must never block the agent.

### Liveness — two-layer reaper

Hooks cannot tell us about a `kill -9`, a tmux crash, or a terminal close. The daemon detects death on its own, in two layers:

1. **Process-level (fast, fine-grained).** Hook payloads include the agent's pid (`$PPID` from inside the hook script — the agent process that invoked the hook). Daemon polls `kill(pid, 0)` every ~1s; `ESRCH` means dead. Cheap, cross-platform, gives ~1s detection latency.
2. **tmux-level (slow, coarse, always correct).** Every ~3s the daemon runs `tmux list-panes -aF '#{pane_id} #{pane_pid}'`. Any tracked `pane_id` that no longer appears is reaped. This catches edge cases the process check misses (agent process replaced via `exec`, daemon started after the agent died, etc.).

Optional optimization later: `pidfd_open` + epoll on Linux, `kqueue` + `NOTE_EXIT` on macOS, for zero-latency exit notification. Skip until polling proves insufficient.

## File layout (runtime)

Follow the XDG Base Directory spec.

### Config — `$XDG_CONFIG_HOME/switchboard/` (default `~/.config/switchboard/`)
User-editable. Survives reinstalls.

- `config.toml` — global settings (sidebar width, default tool, keybindings, notification preferences).
- `spaces.toml` — optional explicit space definitions. Spaces can also be inferred.

### State — `$XDG_STATE_HOME/switchboard/` (default `~/.local/state/switchboard/`)
Yes, this is the correct location per the [XDG spec](https://specifications.freedesktop.org/basedir-spec/latest/) — "state data that should persist between (application) restarts but is not important or portable enough" (logs, history, persistent agent snapshots).

- `agents/<pane-id>.json` — per-pane agent state snapshot.
- `panels/<owner-pane-id>.json` — sidebar/panel selection per owner pane.
- `nvim-context/*.json` — optional Neovim picker context keyed by cwd.
- `agent-tmux.generated.conf` — generated minimal tmux config for the agent server when the user has no `switchboard.conf`.
- `daemon.log` — daemon log.

### Runtime — `$XDG_RUNTIME_DIR/switchboard/` (default `/run/user/$UID/switchboard/`)
Sockets, pid files, anything that should not survive a reboot.

- `switchboard.sock` — daemon socket.
- `daemon.pid` — running daemon pid.

If `$XDG_RUNTIME_DIR` is unset (rare; macOS), fall back to a temp dir, not state.

## Project structure

Single binary. CLI, daemon, and TUI all live in one Bun-compiled executable, dispatched by subcommand:

- `switchboard daemon start|stop|status` — long-running socket server.
- `switchboard sidebar` — launches the TUI in the current pane. This is what `plugin.tmux` runs.
- `switchboard integration install <claude|codex|opencode>` — installs hooks into agent configs.
- `switchboard agent-picker`, `switchboard new-agent`, `switchboard pick`, `switchboard send`, `switchboard agent-toggle`, `switchboard agent-tmux`, etc. — small CLIs used by tmux bindings, popups, and the Neovim plugin.

```
switchboard/
├── plugin.tmux            # tmux plugin entrypoint — sourced by TPM
├── nvim/                  # optional Neovim companion plugin
├── cli/                   # the single binary lives here
│   ├── src/
│   │   ├── index.tsx      # entry — argv router into commands / daemon / sidebar
│   │   ├── commands/      # subcommand implementations
│   │   ├── daemon/        # socket server, state, reaper, persistence
│   │   ├── sidebar/       # OpenTUI sidebar
│   │   ├── picker/        # OpenTUI file picker, previews, syntax, and result model
│   │   ├── integrations/  # hook installers and integration-specific config patching
│   │   └── shared/        # protocol types, paths, etc.
│   └── package.json
├── AGENTS.md              # this file
└── README.md              # user-facing
```

Build the binary with `bun build --compile` (see `cli/package.json`). Output is a single statically-linked executable. The `build:debug` script is already set up — production target will mirror it without `--sourcemap`.

Subdirs under `src/` are aspirational — create them as the work calls for it. Do not scaffold ahead of need.

## Tech stack

- **Everything is Bun + TypeScript.** One runtime, one binary, shared types end-to-end.
- **TUI:** [OpenTUI](https://github.com/sst/opentui) (`@opentui/core`, `@opentui/react`). **Always load the `opentui` skill before writing TUI code** — it's vendored under `.agents/skills/opentui` precisely so an agent working here has the API reference at hand.
- **Daemon:** Bun's built-in `Bun.listen` / `Bun.connect` for Unix sockets. No external server framework.
- **Hooks:** shell scripts (Claude, Codex) or JS plugin (OpenCode). Bundled into the binary as text and written to disk by `integration install`. Keep hooks small and non-blocking.
- **tmux glue:** `plugin.tmux` binds keys and calls CLI subcommands. Runtime behavior lives in TypeScript, not standalone shell scripts.
- **Neovim:** Lua plugin under `nvim/`, with EmmyLua types in the public setup surface.

## Conventions

### General
- Follow `~/.agents/instructions/always.md` and the `code-style` skill. Both are loaded automatically; do not duplicate their rules here.
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`).
- No co-author lines.

### TypeScript
- Strict, no `any`. Prefer `unknown` and narrow.
- Discriminated unions for agent status, not optional fields.
- `readonly` for daemon-side state types.

### Hooks (shell + python)
- `set -eu` at the top of every shell hook.
- Hooks may shell out to `python3` for socket work — it's preinstalled on every machine that runs coding agents, and it's what herdr uses. JS plugins (OpenCode) use Node's `net.createConnection`.
- 500ms socket timeout. Fire-and-forget. Exit 0 on any error — never block the parent agent.
- Pane id resolves from `$SWITCHBOARD_PANE_ID`, falling back to `$TMUX_PANE`. Socket path from `$SWITCHBOARD_SOCKET_PATH`, falling back to `$XDG_RUNTIME_DIR/switchboard/switchboard.sock`. If neither pane id source is set, exit 0.

### tmux scripts
- `set -euo pipefail`.
- Quote everything. Always.
- No dependencies beyond `jq` and coreutils.

### tmux interactions
- Always resolve the **owner pane** before acting. A pane hosting our sidebar TUI is not the agent pane; an agent's nested session is not its parent.
- Defer focus changes triggered from popups until after the popup exits (see `agent-mux`'s `apply-focus` pattern).
- Never call `switch-client` without specifying `-c <client-tty>` when invoked from a nested context.

### Naming
- kebab-case filenames.
- Status values are lowercase: `working`, `idle`, `blocked`, `unknown`.
- Tool names are lowercase: `claude`, `codex`, `opencode`.

## Out of scope (for now)

- Windows support.
- Non-tmux multiplexers (zellij, screen).
- Remote agents over SSH.
- A standalone TUI that replaces tmux. Switchboard *augments* tmux; it does not compete with it.

## Reference

- herdr: https://github.com/ogulcancelik/herdr — read `INTEGRATIONS.md` and `SOCKET_API.md` for hook contracts worth copying.
- sidekick.nvim: https://github.com/folke/sidekick.nvim — useful reference for Neovim-to-agent workflows and editor-side context.
- Claude Code hooks: https://docs.claude.com/en/docs/claude-code/hooks
- XDG Base Directory spec: https://specifications.freedesktop.org/basedir-spec/latest/

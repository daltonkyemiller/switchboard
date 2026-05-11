# switchboard

A tmux plugin for managing running coding agents (Claude Code, Codex, OpenCode, etc.) across a workspace. Inspired by [herdr](https://github.com/ogulcancelik/herdr), but tmux-native instead of a full standalone TUI — switchboard lives inside your existing tmux session.

This document orients agents working on the switchboard codebase. It describes what we are building, how the pieces fit together, and the conventions to follow.

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

## Current scope

We are building in this order. Do not get ahead of it.

1. **Daemon + agent state.** Unix socket, JSON-RPC envelopes, in-memory state keyed by `pane_id`, persistence snapshot, and a reaper that drops state for dead panes/sessions.
2. **Integrations.** `switchboard integration install {claude,codex,opencode}` — installs hook scripts/plugins and patches the agent's config. Hooks report `working | idle | blocked | release`.
3. **TUI sidebar for the current cwd.** Lists agents whose cwd matches the cwd of the tmux pane hosting the sidebar. Live updates via socket subscription. No spaces yet — spaces are a later layer on top.
4. **tmux keybindings.** Toggle sidebar, jump to agent, open new agent session.

Deferred: spaces, multi-cwd view, "all agents" view, remote agents, non-tmux multiplexers.

## Design principles

These are load-bearing — violate them and the tool will feel broken.

- **Client routing matters.** Nested tmux clients make naive `switch-client` calls hit the wrong context. Resolve the owner pane before acting; defer focus until after popups exit.
- **State per pane.** Agent state is keyed by tmux `pane_id`. Nested/sidekick sessions resolve back to their parent pane.
- **Hook + heuristic.** Hooks provide semantic status (working/idle/blocked). Process + pane liveness provides existence. Neither alone is sufficient — if the pane is dead, the agent is gone, regardless of last reported state.
- **Cleanup is part of the protocol.** A background reaper sweeps stale state for killed panes/sessions. The TUI must never show ghosts.
- **Hooks never block the agent.** 500ms timeout, fire-and-forget. A dead daemon must not freeze Claude.

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

Four moving parts:

1. **Hooks** — installed into Claude Code, Codex, OpenCode. Send JSON status events on lifecycle events (`UserPromptSubmit`, `PreToolUse`, `Stop`, `PermissionRequest`, `SessionEnd`).
2. **Daemon** — listens on a Unix socket. Maintains the in-memory state of all agents and spaces. Persists snapshots so it can rebuild on restart.
3. **TUI sidebar** (`tui/`) — subscribes to daemon events, renders the spaces + agents list. Sends back user actions (jump to agent, kill session, open new session). Hosted in a tmux pane.
4. **tmux integration** (`plugin.tmux`) — keybindings, popup pickers, layout helpers, and the script that launches the sidebar pane.

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
- `spaces.json` — last known spaces snapshot.
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
- `switchboard list`, `switchboard jump`, etc. — small CLIs used by tmux bindings.

```
switchboard/
├── plugin.tmux            # tmux plugin entrypoint — sourced by TPM
├── scripts/               # bash helpers invoked from tmux bindings (pickers, etc.)
├── cli/                   # the single binary lives here
│   ├── src/
│   │   ├── index.tsx      # entry — argv router into commands / daemon / sidebar
│   │   ├── commands/      # subcommand implementations
│   │   ├── daemon/        # socket server, state, reaper, persistence
│   │   ├── sidebar/       # OpenTUI sidebar
│   │   ├── hooks-assets/  # bundled hook payloads, imported as text
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
- **Hooks:** shell scripts (Claude, Codex) or JS plugin (OpenCode). Bundled into the binary as text and written to disk by `integration install`. Match herdr's ~70-line ceiling per hook.
- **tmux glue:** bash in `scripts/`, sourced from `plugin.tmux`.

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
- Claude Code hooks: https://docs.claude.com/en/docs/claude-code/hooks
- XDG Base Directory spec: https://specifications.freedesktop.org/basedir-spec/latest/

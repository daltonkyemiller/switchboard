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

## Prior art in `~/dev/dot`

The user has been running a personal solution called `agent-mux` for some time:

- `~/dev/dot/docs/agent-mux.md` — design doc.
- `~/dev/dot/scripts/agent-mux` — bash implementation (~970 lines).

Switchboard is the productized successor. The same lessons apply:

- **Client routing matters.** Nested tmux clients make naive `switch-client` calls hit the wrong context. Resolving owner panes and deferring focus until after popup exit is non-negotiable.
- **State per pane.** Each agent state file is keyed by tmux `pane_id`. Sidekick/nested sessions resolve back to their parent pane.
- **Hook + heuristic.** Hooks provide semantic status (working/idle/blocked). Process and pane detection provide liveness. Neither alone is sufficient.
- **Cleanup is part of the protocol.** Stale state from killed tmux sessions must be reaped, not surfaced.

Do not reimplement agent-mux verbatim — it is a starting point, not a spec. Switchboard should be tighter, better-typed, and shareable.

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

```
switchboard/
├── plugin.tmux            # tmux plugin entrypoint — sourced by TPM
├── scripts/               # bash helpers invoked from tmux bindings
├── tui/                   # OpenTUI sidebar (Bun + React)
│   └── src/index.tsx
├── daemon/                # daemon (language TBD — likely Bun/TS to share types with TUI)
├── hooks/                 # bundled hook payloads, one dir per supported tool
│   ├── claude/
│   ├── codex/
│   └── opencode/
├── AGENTS.md              # this file
└── README.md              # user-facing
```

`daemon/` and `hooks/` do not exist yet. Create them when the work calls for it; do not scaffold ahead of need.

## Tech stack

- **TUI:** [OpenTUI](https://github.com/sst/opentui) (`@opentui/core`, `@opentui/react`) running on Bun. See `tui/package.json`. Relevant skill: `opentui` (already vendored under `.agents/skills/opentui`).
- **Daemon:** TypeScript on Bun is the current direction (shared types with the TUI). Open to revisiting if the daemon needs to be a single static binary for distribution.
- **Hooks:** bash. Keep them tiny, dependency-free, and idempotent. Match herdr's ~70-line ceiling per hook.
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

### Bash (hooks + tmux scripts)
- `set -euo pipefail`.
- Quote everything. Always.
- No dependencies beyond `jq`, `socat`/`nc`, and coreutils.
- Hooks must exit 0 on socket errors — never block the parent agent.

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
- agent-mux: `~/dev/dot/docs/agent-mux.md`, `~/dev/dot/scripts/agent-mux` — prior art.

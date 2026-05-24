# switchboard

A tmux-native sidebar for managing running coding agents across a workspace.

![Switchboard tmux workspace overview](assets/switchboard-overview.png)

Switchboard keeps Claude Code, Codex, OpenCode, and other agent sessions inside
your existing tmux workflow. It gives you a sidebar for the running agents,
popup pickers for files and sessions, and enough routing glue that nested agent
tmux sessions do not fight your main tmux layout.

## Features

- **Agent sidebar.** See agents for the current cwd or every Switchboard-managed
  agent, grouped by cwd. Status shows idle, working, blocked, unknown, and
  whether the agent is currently attached.
- **Attach, follow, preview, detach, kill.** Jump to an attached agent pane,
  attach an agent into the current window, preview a session in a popup, detach
  viewers, or kill stale agent sessions from the sidebar.
- **Integrated agent picker.** Open a tmux popup that can create a new Claude,
  Codex, or OpenCode session, or attach to an existing one. It starts scoped to
  the current cwd and has an all-agents tab.
- **Toggle-or-create workflow.** Bind one key to show/hide the last used agent
  for the current cwd. If none exists, Switchboard opens the agent picker.
- **Custom file picker.** Insert `@path` references into an agent with a
  terminal-native picker. It supports file and content search, directories,
  Nerd Font icons, Neovim-ranked results, and highlighted matches.
- **Tree-sitter previews.** File previews use Tree-sitter-backed syntax
  highlighting, Markdown rendering where useful, configurable colors, and
  user-installed grammars.
- **Neovim companion plugin.** Neovim reports current file, alternate file,
  open buffers, and recent files to the daemon so the picker can rank editor
  context first. The plugin can also send selections or file references to an
  agent.
- **Separate agent tmux server.** Agents run on their own tmux socket with a
  generated minimal config or your own `switchboard.conf`, which keeps agent
  mappings from clobbering your main tmux session.
- **tmux routing.** Split, layout, swap, popup, and passthrough mappings are
  routed so the sidebar stays anchored and selected keys can pass through to
  the nested agent server.
- **Configurable launchers and theme.** Override agent commands and flags,
  configure picker colors, syntax scopes, icons, sidebar density, and tmux
  plugin keybindings.

## Examples

### File Picker

![Switchboard custom file picker with syntax preview](assets/custom-file-picker.png)

### Agent Picker

![Switchboard agent attach and create picker](assets/agent-attach-picker.png)

## Configuration

Switchboard configuration is documented in
[`docs/configuration.md`](docs/configuration.md).

The main config file is:

```text
~/.config/switchboard/config.toml
```

Related config files:

- `~/.config/switchboard/grammars.toml` for user-installed Tree-sitter grammars.
- `~/.config/switchboard/switchboard.conf` for the dedicated agent tmux server.
- tmux `@switchboard-*` options in your normal tmux config for plugin keybindings and sidebar behavior.

After editing `switchboard.conf`, reload the running agent tmux server with:

```sh
switchboard agent-tmux reload
```

## Neovim Companion

An optional companion plugin lives in [`nvim/`](nvim/). It should load at
startup so Switchboard has current editor context before the picker opens:

```lua
---@type LazySpec
return {
  dir = "~/dev/switchboard/nvim",
  name = "switchboard.nvim",
  lazy = false,
  ---@type SwitchboardConfig
  opts = {
    command = "switchboard",
  },
}
```

Neovim reports context directly to the Switchboard daemon. The old state-file
path is now only a fallback/cache:

```text
~/.local/state/switchboard/nvim-context/
```

The picker asks the daemon for current file, alternate file, open buffers, and
recent files, then falls back to a recent cache file if the daemon is
unavailable. See [`nvim/README.md`](nvim/README.md) for the send-selection and
file-reference APIs.

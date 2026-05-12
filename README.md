# switchboard

A tmux-native sidebar for managing running coding agents across a workspace.

## Configuration

Switchboard configuration is documented in
[`docs/configuration.md`](docs/configuration.md).

The main config file is:

```text
~/.config/switchboard/config.toml
```

Related config files:

- `~/.config/switchboard/grammars.toml` for user-installed Tree-sitter grammars.
- `~/.config/switchboard/agent-tmux.conf` for the dedicated agent tmux server.
- tmux `@switchboard-*` options in your normal tmux config for plugin keybindings and sidebar behavior.

## Neovim Companion

An optional companion plugin lives in [`nvim/`](nvim/). Add it to your Neovim
plugin manager and call:

```lua
require("switchboard").setup()
```

It writes editor context under `~/.local/state/switchboard/nvim-context/` so the
picker can rank current, alternate, open-buffer, and recent files first.

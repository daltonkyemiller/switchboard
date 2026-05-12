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

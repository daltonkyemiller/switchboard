# Configuration

Switchboard reads user-editable config from `$XDG_CONFIG_HOME/switchboard/`.
With the default XDG paths, that is `~/.config/switchboard/`.

Runtime files live under `$XDG_RUNTIME_DIR/switchboard/`, and state files live
under `$XDG_STATE_HOME/switchboard/`. Those are not meant to be edited by hand.

## `config.toml`

Path: `~/.config/switchboard/config.toml`

This is the main Switchboard config file. Every section is optional.

```toml
[agents.claude]
command = "claude"
args = []

[agents.codex]
command = "codex"
args = []

[agents.opencode]
command = "opencode"
args = []

[picker.theme]
dim_fg = "ansi:8"
prompt_fg = "ansi:3"
item_fg = "default"
selected_fg = "default"
selected_bg = "ansi:0"
path_fg = "ansi:8"
accent = "ansi:6"
panel_bg = "background"

[picker.syntax]
theme_file = ""
default = { fg = "default" }
keyword = { fg = "ansi:1", bold = true }
string = { fg = "ansi:2" }
comment = { fg = "ansi:8", italic = true }
number = { fg = "ansi:5" }
function = { fg = "ansi:6" }
type = { fg = "ansi:3" }
property = { fg = "ansi:4" }

[picker.syntax."markup.heading.1"]
fg = "ansi:4"
bold = true
underline = true
```

### Agent Commands

The sidebar `n` shortcut lists installed Switchboard integrations. An
integration is considered installed when `switchboard integration install
<tool>` has written that tool's hook or plugin.

Each `[agents.<tool>]` section can override how that agent is launched:

```toml
[agents.claude]
command = "claude --dangerously-skip-permissions"

[agents.codex]
command = "codex"
args = ["--model", "gpt-5.2"]
```

`command` is passed to the shell as the base command. `args` are shell-quoted
and appended after `command`, followed by any extra arguments passed to
`switchboard new`.

For example:

```toml
[agents.codex]
command = "codex"
args = ["--model", "gpt-5.2"]
```

Then:

```sh
switchboard new codex --ask-for-approval never
```

Runs:

```sh
codex --model gpt-5.2 --ask-for-approval never
```

Supported agent sections:

| Section | Default command |
| --- | --- |
| `[agents.claude]` | `claude` |
| `[agents.codex]` | `codex` |
| `[agents.opencode]` | `opencode` |

The standalone launcher is available as:

```sh
switchboard new-agent
```

The tmux plugin can open it in a popup with `@switchboard-new-agent-key` or
`@switchboard-new-agent-key-no-prefix`. The sidebar `n` shortcut uses the same
popup launcher.

### Picker Theme

`[picker.theme]` controls picker UI colors.

| Key | Meaning |
| --- | --- |
| `dim_fg` | Muted text, empty states, secondary labels |
| `prompt_fg` | Search prompt and high-emphasis prompt text |
| `item_fg` | Normal list item text |
| `selected_fg` | Selected list item text |
| `selected_bg` | Selected list item background |
| `path_fg` | File path and location text |
| `accent` | Accent color for matches and active details |
| `panel_bg` | Picker panel background |

Color values can be:

- Hex strings: `"#8ec07c"`
- ANSI slots: `"ansi:6"` or integer slots like `6`
- Terminal defaults: `"default"`, `"foreground"`, `"default-foreground"`,
  `"background"`, or `"default-background"`

### Picker Syntax

`[picker.syntax]` controls Tree-sitter-backed preview highlighting.

`theme_file` can point to a VS Code/TextMate-style JSON theme:

```toml
[picker.syntax]
theme_file = "~/themes/miasma-color-theme.json"
```

Paths may be absolute, `~/...`, or relative to `~/.config/switchboard/`.

Direct entries in `[picker.syntax]` override both built-in defaults and styles
loaded from `theme_file`.

```toml
[picker.syntax]
keyword = { fg = "ansi:1", bold = true }
comment = { fg = "ansi:8", italic = true }
```

Style keys can use either snake case or TextMate-style names:

| Key | Meaning |
| --- | --- |
| `fg` / `foreground` | Foreground color |
| `bg` / `background` | Background color |
| `bold` | Boolean |
| `italic` | Boolean |
| `underline` | Boolean |
| `dim` | Boolean |
| `font_style` / `fontStyle` | Space-separated style string, such as `"bold italic"` |

Common syntax scopes include:

- `default`
- `keyword`
- `keyword.import`
- `keyword.operator`
- `string`
- `comment`
- `number`
- `boolean`
- `constant`
- `function`
- `function.call`
- `function.method.call`
- `type`
- `constructor`
- `variable`
- `variable.member`
- `property`
- `operator`
- `punctuation`
- `punctuation.bracket`
- `punctuation.delimiter`
- `markup.heading`
- `markup.heading.1`
- `markup.heading.2`
- `markup.bold`
- `markup.strong`
- `markup.italic`
- `markup.list`
- `markup.quote`
- `markup.raw`
- `markup.raw.block`
- `markup.link`
- `markup.link.url`

## `grammars.toml`

Path: `~/.config/switchboard/grammars.toml`

This file registers additional Tree-sitter grammars for picker previews. It is
usually written by `switchboard grammar add`, but it is safe to edit manually.

```toml
[[grammar]]
filetype = "lua"
extensions = [".lua"]
basenames = []
aliases = ["lua"]
wasm = "~/.local/share/switchboard/grammars/lua/tree-sitter-lua.wasm"
highlights = ["~/.local/share/switchboard/grammars/lua/highlights.scm"]
injections = []
```

| Key | Required | Meaning |
| --- | --- | --- |
| `filetype` | yes | OpenTUI filetype name used for highlighting |
| `extensions` | no | File extensions mapped to this grammar |
| `basenames` | no | Exact file names mapped to this grammar |
| `aliases` | no | Additional parser aliases |
| `wasm` | yes | Path to the grammar WASM file |
| `highlights` | yes | One or more Tree-sitter highlight query files |
| `injections` | no | Optional injection query files |

Paths may be absolute, `~/...`, or relative to `~/.config/switchboard/`.

Built-in filetype mappings currently include TypeScript, TSX, JavaScript, JSX,
Markdown, JSON, CSS, HTML, Dockerfile, and Makefile. User grammars are checked
before built-ins, so a user grammar can override a built-in extension or
basename.

## Neovim Companion

The optional Neovim plugin under `nvim/` writes editor context for the picker:

```lua
require("switchboard").setup({
  enabled = true,
  debounce_ms = 150,
  max_open_buffers = 20,
  max_recent_files = 50,
  state_dir = "~/.local/state/switchboard/nvim-context",
})
```

Context is stored under:

```text
~/.local/state/switchboard/nvim-context/
```

The picker uses this to rank the current file, alternate file, open buffers,
and recent files ahead of normal file search results. The picker still works
normally when no Neovim context exists.

## `agent-tmux.conf`

Path: `~/.config/switchboard/agent-tmux.conf`

Switchboard runs agent sessions on a separate tmux server at
`$XDG_RUNTIME_DIR/switchboard/agent-tmux.sock`. If `agent-tmux.conf` exists,
Switchboard starts that server with this config. Otherwise it writes a generated
minimal config under `$XDG_STATE_HOME/switchboard/agent-tmux.generated.conf`.

The generated config is intentionally sparse:

```tmux
set -g default-command "${SHELL}"
set -g prefix None
set -g prefix2 None
unbind-key -a
unbind-key -a -T root
set -g status off
set -g mouse off
set -g pane-border-status off
set -g escape-time 10
set -g focus-events on
set -g default-terminal "tmux-256color"
```

Use `agent-tmux.conf` when you want a custom minimal agent-server environment.
Avoid sourcing your normal `~/.tmux.conf` here unless you explicitly want those
bindings inside nested agent sessions.

## tmux Plugin Options

These options are set in your normal tmux config before loading the plugin.
They are tmux options, not `config.toml` keys.

```tmux
set -g @switchboard-bin "switchboard"
set -g @switchboard-command "switchboard sidebar"
set -g @switchboard-toggle-key "a"
set -g @switchboard-toggle-key-no-prefix ""
set -g @switchboard-sidebar-width "32"
set -g @switchboard-sidebar-max-width ""
set -g @switchboard-sidebar-density "dense"
set -g @switchboard-router "on"
set -g @switchboard-router-split-h "%"
set -g @switchboard-router-split-v '"'
set -g @switchboard-router-next-layout "Space"
set -g @switchboard-router-swap-prev "{"
set -g @switchboard-router-swap-next "}"
set -g @switchboard-picker-key ""
set -g @switchboard-picker-key-no-prefix ""
set -g @switchboard-new-agent-key ""
set -g @switchboard-new-agent-key-no-prefix ""
```

| Option | Default | Meaning |
| --- | --- | --- |
| `@switchboard-bin` | `switchboard` | Binary used by plugin scripts |
| `@switchboard-command` | `<@switchboard-bin> sidebar` | Command run inside the sidebar pane |
| `@switchboard-toggle-key` | unset | Prefix-table key to toggle the sidebar |
| `@switchboard-toggle-key-no-prefix` | unset | Global key to toggle the sidebar |
| `@switchboard-sidebar-width` | `32` | Sidebar width and enforced minimum |
| `@switchboard-sidebar-max-width` | unset | Optional maximum sidebar width |
| `@switchboard-sidebar-density` | `dense` | Sidebar spacing preset: `dense`, `normal`, or `loose` |
| `@switchboard-router` | `on` | Route split/layout/swap keys so the sidebar stays anchored |
| `@switchboard-router-split-h` | `%` | Routed horizontal split key |
| `@switchboard-router-split-v` | `"` | Routed vertical split key |
| `@switchboard-router-next-layout` | `Space` | Routed layout-cycle key |
| `@switchboard-router-swap-prev` | `{` | Routed `swap-pane -U` key |
| `@switchboard-router-swap-next` | `}` | Routed `swap-pane -D` key |
| `@switchboard-picker-key` | unset | Prefix-table picker key |
| `@switchboard-picker-key-no-prefix` | unset | Global picker key |
| `@switchboard-new-agent-key` | unset | Prefix-table new-agent popup key |
| `@switchboard-new-agent-key-no-prefix` | unset | Global new-agent popup key |

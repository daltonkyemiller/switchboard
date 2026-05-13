# switchboard.nvim

Optional Neovim companion plugin for Switchboard.

```lua
require("switchboard").setup()
```

The plugin writes lightweight editor context to:

```text
~/.local/state/switchboard/nvim-context/
```

Switchboard's picker uses that context to rank the current file, alternate
file, open buffers, and recent files ahead of normal file search results.

Manual refresh:

```vim
:SwitchboardWriteContext
```

The state path can be overridden:

```lua
---@type SwitchboardConfig
local opts = {
  command = "switchboard",
  state_dir = vim.fn.expand("~/.local/state/switchboard/nvim-context"),
  send = {
    submit = true,
    select_agent = false,
    focus = false,
  },
}

require("switchboard").setup(opts)
```

`send` controls the defaults for every send command:

```lua
---@type SwitchboardConfig
local opts = {
  send = {
    submit = true,        -- press Enter after sending
    select_agent = false, -- open the agent selector before sending
    focus = false,        -- focus or open the target agent pane after sending
  },
}
```

Each send call can override those defaults.

If `switchboard` is not on Neovim's PATH, set `command` to the full binary
path:

```lua
---@type SwitchboardConfig
local opts = {
  command = "/home/dalton/dev/switchboard/cli/dist/debug/switchboard",
}

require("switchboard").setup(opts)
```

## Sending Selection To Agents

The companion plugin exposes a small Lua API:

```lua
require("switchboard.commands").send_selection()
require("switchboard.commands").send_selection_reference()
require("switchboard.commands").send_file_reference()
```

By default it sends the last visual selection to the same cwd agent used by
`switchboard agent-toggle`.

`send_selection()` sends the selected text. `send_selection_reference()` sends a
file reference such as `@README.md:3` or `@README.md:3-8`.
`send_file_reference()` sends only the file reference, such as `@README.md`.

All three commands accept the same options:

```lua
require("switchboard.commands").send_selection({
  command = "switchboard", -- binary path, overrides setup()
  cwd = vim.uv.cwd(),      -- cwd used for active-agent lookup
  submit = true,           -- press Enter after sending
  select_agent = false,    -- open the agent selector before sending
  focus = false,           -- focus or open the target agent pane after sending
})
```

`send_selection()` also accepts `text`, `lines`, `line1`, and `line2` when you
want to bypass the visual selection.

To choose the target agent in a Switchboard popup:

```lua
require("switchboard.commands").send_selection({
  select_agent = true,
})
```

To focus the target agent after sending:

```lua
require("switchboard.commands").send_selection({
  focus = true,
})
```

To send explicit text:

```lua
require("switchboard.commands").send_selection({
  text = "explain this file",
  submit = true,
})
```

File references are formatted relative to the target agent's cwd. If you open
the selector and pick an agent in another repo, Switchboard builds the
`@path[:line]` reference for that agent.

The plugin also defines:

```vim
:SwitchboardSendSelection
:SwitchboardSendSelection!
:SwitchboardSendReference
:SwitchboardSendReference!
:SwitchboardSendFileReference
:SwitchboardSendFileReference!
```

The bang form opens the agent selector before sending.

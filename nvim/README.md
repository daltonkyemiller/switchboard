# switchboard.nvim

Optional Neovim companion plugin for Switchboard.

With lazy.nvim:

```lua
---@type LazySpec
return {
  "daltonkyemiller/switchboard",
  name = "switchboard.nvim",
  lazy = false,
  init = function(plugin)
    vim.opt.rtp:append(plugin.dir .. "/nvim")
  end,
  ---@type SwitchboardConfig
  opts = {
    command = "switchboard",
  },
}
```

For local development, use a local `dir` instead:

```lua
---@type LazySpec
return {
  dir = "~/dev/switchboard/nvim",
  name = "switchboard.nvim",
  lazy = false,
  ---@type SwitchboardConfig
  opts = {
    command = "/home/dalton/dev/switchboard/cli/dist/debug/switchboard",
  },
}
```

Or directly:

```lua
require("switchboard").setup()
```

The plugin reports lightweight editor context to the Switchboard daemon. It also
writes a fallback/cache file under:

```text
~/.local/state/switchboard/nvim-context/
```

Switchboard's picker asks the daemon for the latest context first, then falls
back to that file if the daemon is unavailable. It uses the context to rank the
current file, alternate file, open buffers, and recent files ahead of normal
file search results. Those files also get an `NV` badge in the picker.

Manual refresh:

```vim
:SwitchboardWriteContext
```

## Configuration

Every option is optional, but `command` should be set when `switchboard` is not
on Neovim's PATH.

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

Options:

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Report picker context from Neovim |
| `debounce_ms` | `150` | Debounce for context writes |
| `max_open_buffers` | `20` | Maximum open buffers stored in picker context |
| `max_recent_files` | `50` | Maximum recent files stored in picker context |
| `state_dir` | `~/.local/state/switchboard/nvim-context` | Fallback/cache directory where picker context JSON is written |
| `command` | `"switchboard"` | Switchboard CLI executable or absolute path |
| `send` | see below | Defaults for send commands |

`send` controls the defaults for every send command. Each API call can override
these:

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

For local development, point `command` at the debug binary:

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

## Commands

The plugin defines:

```vim
:SwitchboardSendSelection
:SwitchboardSendSelection!
:SwitchboardSendReference
:SwitchboardSendReference!
:SwitchboardSendFileReference
:SwitchboardSendFileReference!
```

The bang form opens the agent selector before sending.

Useful mappings:

```lua
vim.keymap.set("v", "<leader>as", "<cmd>SwitchboardSendSelection<cr>")
vim.keymap.set("v", "<leader>aS", "<cmd>SwitchboardSendSelection!<cr>")
vim.keymap.set("v", "<leader>ar", "<cmd>SwitchboardSendReference<cr>")
vim.keymap.set("n", "<leader>af", "<cmd>SwitchboardSendFileReference<cr>")
```

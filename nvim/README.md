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
  },
}

require("switchboard").setup(opts)
```

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

To choose the target agent in a Switchboard popup:

```lua
require("switchboard.commands").send_selection({
  select_agent = true,
})
```

To send explicit text:

```lua
require("switchboard.commands").send_selection({
  text = "explain this file",
  submit = true,
})
```

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

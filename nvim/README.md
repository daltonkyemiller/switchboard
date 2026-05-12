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
require("switchboard").setup({
  command = "switchboard",
  state_dir = vim.fn.expand("~/.local/state/switchboard/nvim-context"),
  send = {
    submit = true,
    select_agent = false,
  },
})
```

## Sending Selection To Agents

The companion plugin exposes a small Lua API:

```lua
require("switchboard.commands").send_selection()
```

By default it sends the last visual selection to the same cwd agent used by
`switchboard agent-toggle`.

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
```

The bang form opens the agent selector before sending.

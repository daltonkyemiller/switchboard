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
  state_dir = vim.fn.expand("~/.local/state/switchboard/nvim-context"),
})
```

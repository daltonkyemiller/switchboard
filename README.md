# switchboard

## Picker Theme

The picker reads optional theme settings from `~/.config/switchboard/config.toml`.
Colors accept hex strings, `default`, `background`, `default-foreground`,
`default-background`, ANSI slots like `ansi:6`, or an integer ANSI slot.

```toml
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

`picker.syntax.theme_file` may point to a VS Code/TextMate-style JSON theme.
Direct `picker.syntax` entries override both the built-in defaults and the
imported theme file.

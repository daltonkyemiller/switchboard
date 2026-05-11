#!/usr/bin/env bash
# switchboard — tmux-native agent multiplexer
#
# User-tunable tmux options (set in ~/.tmux.conf before run-plugin):
#   @switchboard-toggle-key            "a"    → binds <prefix>+a
#   @switchboard-toggle-key-no-prefix  "M-a"  → binds Alt-a globally (no prefix)
#   @switchboard-sidebar-width         columns of the sidebar pane (default: 32)
#   @switchboard-command               command to run in the sidebar pane
#                                       (default: "switchboard sidebar")
#
# Either or both toggle-key options may be set. Manual binding (no options):
#   bind   a run-shell "~/.tmux/plugins/switchboard/scripts/sidebar-toggle.sh"
#   bind -n M-a run-shell "~/.tmux/plugins/switchboard/scripts/sidebar-toggle.sh"

CURRENT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

tmux_option_or_default() {
  local option="$1"
  local default="$2"
  local value
  value=$(tmux show-options -gqv "$option")
  [[ -n "$value" ]] && printf '%s' "$value" || printf '%s' "$default"
}

toggle_key=$(tmux_option_or_default "@switchboard-toggle-key" "")
toggle_key_no_prefix=$(tmux_option_or_default "@switchboard-toggle-key-no-prefix" "")
sidebar_width=$(tmux_option_or_default "@switchboard-sidebar-width" "32")
sidebar_command=$(tmux_option_or_default "@switchboard-command" "switchboard sidebar")

tmux set-option -g "@switchboard-script-dir" "$CURRENT_DIR/scripts"

toggle_invocation="SWITCHBOARD_SIDEBAR_WIDTH='$sidebar_width' SWITCHBOARD_SIDEBAR_COMMAND='$sidebar_command' $CURRENT_DIR/scripts/sidebar-toggle.sh"

if [[ -n "$toggle_key" ]]; then
  tmux bind-key "$toggle_key" run-shell "$toggle_invocation"
fi

if [[ -n "$toggle_key_no_prefix" ]]; then
  tmux bind-key -n "$toggle_key_no_prefix" run-shell "$toggle_invocation"
fi

#!/usr/bin/env bash
# switchboard — tmux-native agent multiplexer
#
# User-tunable tmux options (set in ~/.tmux.conf before run-plugin):
#   @switchboard-toggle-key            "a"    → binds <prefix>+a
#   @switchboard-toggle-key-no-prefix  "M-a"  → binds Alt-a globally (no prefix)
#   @switchboard-sidebar-width         columns of the sidebar (default: 32)
#                                       also the enforced minimum width
#   @switchboard-sidebar-max-width     maximum sidebar width (default: unset)
#                                       set to e.g. "48" to clamp the upper bound
#   @switchboard-bin                   path to the switchboard binary
#                                       (default: "switchboard"). Used by every
#                                       script that needs to invoke switchboard.
#   @switchboard-command               override the sidebar command. Defaults to
#                                       "<@switchboard-bin> sidebar". Only set if
#                                       you need custom flags or a different cmd.
#   @switchboard-router                "on" | "off" (default: on)
#                                       when on, rebinds split/layout/cycle
#                                       keys to route through scripts/router.sh
#                                       so the sidebar stays anchored.
#   @switchboard-router-split-h        key bound to horizontal split  (default: %)
#   @switchboard-router-split-v        key bound to vertical split    (default: ")
#   @switchboard-router-next-layout    key bound to next-layout       (default: Space)
#   @switchboard-picker-key            key (prefix-table) for the picker popup
#   @switchboard-picker-key-no-prefix  key (no-prefix) for the picker popup
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
switchboard_bin=$(tmux_option_or_default "@switchboard-bin" "switchboard")
sidebar_command=$(tmux_option_or_default "@switchboard-command" "$switchboard_bin sidebar")
router_enabled=$(tmux_option_or_default "@switchboard-router" "on")
router_split_h=$(tmux_option_or_default "@switchboard-router-split-h" "%")
router_split_v=$(tmux_option_or_default "@switchboard-router-split-v" '"')
router_next_layout=$(tmux_option_or_default "@switchboard-router-next-layout" "Space")
picker_key=$(tmux_option_or_default "@switchboard-picker-key" "")
picker_key_no_prefix=$(tmux_option_or_default "@switchboard-picker-key-no-prefix" "")

tmux set-option -g "@switchboard-script-dir" "$CURRENT_DIR/scripts"

toggle_invocation="SWITCHBOARD_SIDEBAR_WIDTH='$sidebar_width' SWITCHBOARD_SIDEBAR_COMMAND='$sidebar_command' $CURRENT_DIR/scripts/sidebar-toggle.sh"

if [[ -n "$toggle_key" ]]; then
  tmux bind-key "$toggle_key" run-shell "$toggle_invocation"
fi

if [[ -n "$toggle_key_no_prefix" ]]; then
  tmux bind-key -n "$toggle_key_no_prefix" run-shell "$toggle_invocation"
fi

tmux set-option -g "@switchboard-sidebar-width" "$sidebar_width"
tmux set-hook -g -a window-layout-changed "run-shell '$CURRENT_DIR/scripts/sidebar-enforce-width.sh'"
tmux set-hook -g -a client-resized "run-shell '$CURRENT_DIR/scripts/sidebar-enforce-width.sh'"

if [[ "$router_enabled" == "on" ]]; then
  router="$CURRENT_DIR/scripts/router.sh"
  # Pass the firing client's active pane id explicitly. tmux expands
  # #{pane_id} at binding-fire time using the client that pressed the key,
  # which is more reliable than $TMUX_PANE (sometimes unset in nested tmux).
  tmux bind-key "$router_split_h"     run-shell "$router split-h #{pane_id}"
  tmux bind-key "$router_split_v"     run-shell "$router split-v #{pane_id}"
  tmux bind-key "$router_next_layout" run-shell "$router next-layout #{pane_id}"
fi

picker_invocation="SWITCHBOARD_BIN='$switchboard_bin' $CURRENT_DIR/scripts/picker.sh #{pane_id}"
if [[ -n "$picker_key" ]]; then
  tmux bind-key "$picker_key" run-shell "$picker_invocation"
fi
if [[ -n "$picker_key_no_prefix" ]]; then
  tmux bind-key -n "$picker_key_no_prefix" run-shell "$picker_invocation"
fi

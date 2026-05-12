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
#                                       keys to route through switchboard router
#                                       so the sidebar stays anchored.
#   @switchboard-router-split-h        key bound to horizontal split  (default: %)
#   @switchboard-router-split-v        key bound to vertical split    (default: ")
#   @switchboard-router-next-layout    key bound to next-layout       (default: Space)
#   @switchboard-router-swap-prev      key bound to swap-pane -U      (default: {)
#   @switchboard-router-swap-next      key bound to swap-pane -D      (default: })
#   @switchboard-picker-key            key (prefix-table) for the picker popup
#   @switchboard-picker-key-no-prefix  key (no-prefix) for the picker popup
#   @switchboard-new-agent-key         key (prefix-table) for new-agent popup
#   @switchboard-new-agent-key-no-prefix key (no-prefix) for new-agent popup
#
# Either or both toggle-key options may be set.

tmux_option_or_default() {
  local option="$1"
  local default="$2"
  local value
  value=$(tmux show-options -gqv "$option")
  [[ -n "$value" ]] && printf '%s' "$value" || printf '%s' "$default"
}

shell_quote() {
  printf "'%s'" "${1//\'/\'\"\'\"\'}"
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
router_swap_prev=$(tmux_option_or_default "@switchboard-router-swap-prev" "{")
router_swap_next=$(tmux_option_or_default "@switchboard-router-swap-next" "}")
picker_key=$(tmux_option_or_default "@switchboard-picker-key" "")
picker_key_no_prefix=$(tmux_option_or_default "@switchboard-picker-key-no-prefix" "")
new_agent_key=$(tmux_option_or_default "@switchboard-new-agent-key" "")
new_agent_key_no_prefix=$(tmux_option_or_default "@switchboard-new-agent-key-no-prefix" "")

switchboard_cmd=$(shell_quote "$switchboard_bin")
toggle_invocation="$switchboard_cmd sidebar-toggle #{pane_id}"

if [[ -n "$toggle_key" ]]; then
  tmux bind-key "$toggle_key" run-shell "$toggle_invocation"
fi

if [[ -n "$toggle_key_no_prefix" ]]; then
  tmux bind-key -n "$toggle_key_no_prefix" run-shell "$toggle_invocation"
fi

tmux set-option -g "@switchboard-sidebar-width" "$sidebar_width"
tmux set-hook -g 'window-layout-changed[90]' "run-shell \"$switchboard_cmd sidebar-enforce-width\""
tmux set-hook -g 'client-resized[90]' "run-shell \"$switchboard_cmd sidebar-enforce-width\""

if [[ "$router_enabled" == "on" ]]; then
  # Pass the firing client's active pane id explicitly. tmux expands
  # #{pane_id} at binding-fire time using the client that pressed the key,
  # which is more reliable than $TMUX_PANE (sometimes unset in nested tmux).
  tmux bind-key "$router_split_h"     run-shell "$switchboard_cmd router split-h #{pane_id}"
  tmux bind-key "$router_split_v"     run-shell "$switchboard_cmd router split-v #{pane_id}"
  tmux bind-key "$router_next_layout" run-shell "$switchboard_cmd router next-layout #{pane_id}"
  tmux bind-key "$router_swap_prev"   run-shell "$switchboard_cmd router swap-prev #{pane_id}"
  tmux bind-key "$router_swap_next"   run-shell "$switchboard_cmd router swap-next #{pane_id}"
fi

picker_invocation="$switchboard_cmd pick-popup #{pane_id}"
if [[ -n "$picker_key" ]]; then
  tmux bind-key "$picker_key" run-shell "$picker_invocation"
fi
if [[ -n "$picker_key_no_prefix" ]]; then
  tmux bind-key -n "$picker_key_no_prefix" run-shell "$picker_invocation"
fi

new_agent_invocation="$switchboard_cmd new-agent-popup #{pane_id}"
if [[ -n "$new_agent_key" ]]; then
  tmux bind-key "$new_agent_key" run-shell "$new_agent_invocation"
fi
if [[ -n "$new_agent_key_no_prefix" ]]; then
  tmux bind-key -n "$new_agent_key_no_prefix" run-shell "$new_agent_invocation"
fi

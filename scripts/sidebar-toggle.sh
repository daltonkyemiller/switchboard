#!/usr/bin/env bash
# Toggle the switchboard sidebar pane in the current tmux window.
# Looks for an existing pane tagged with @switchboard_role=sidebar; kills it
# if found, otherwise opens a new narrow left pane running `switchboard sidebar`.

set -euo pipefail

width="${SWITCHBOARD_SIDEBAR_WIDTH:-32}"
command_line="${SWITCHBOARD_SIDEBAR_COMMAND:-switchboard sidebar}"

existing=$(tmux list-panes -F '#{pane_id} #{@switchboard_role}' 2>/dev/null \
  | awk '$2 == "sidebar" { print $1; exit }')

if [[ -n "$existing" ]]; then
  tmux kill-pane -t "$existing"
  exit 0
fi

new_pane=$(tmux split-window -fhb -l "$width" -P -F '#{pane_id}' \
  -e "OPENTUI_GRAPHICS=false" "$command_line")
tmux set-option -p -t "$new_pane" -q '@switchboard_role' 'sidebar'

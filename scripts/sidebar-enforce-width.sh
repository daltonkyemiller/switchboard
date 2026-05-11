#!/usr/bin/env bash
# Clamp the width of any sidebar pane into [min, max].
# Fired from tmux window-layout-changed / client-resized hooks.
# Throttled to once per 200ms to avoid feedback flicker.

set -euo pipefail

stamp_file="${TMPDIR:-/tmp}/switchboard-enforce-${UID:-$(id -u)}.stamp"
now_ms=$(($(date +%s%N) / 1000000))
last_ms=0
if [[ -f "$stamp_file" ]]; then
  last_ms=$(cat "$stamp_file" 2>/dev/null || echo 0)
fi
if (( now_ms - last_ms < 200 )); then
  exit 0
fi
printf '%s' "$now_ms" >"$stamp_file"

min_width=$(tmux show-options -gqv "@switchboard-sidebar-width" 2>/dev/null || true)
max_width=$(tmux show-options -gqv "@switchboard-sidebar-max-width" 2>/dev/null || true)
min_width="${min_width:-32}"
max_width="${max_width:-0}"

if ! [[ "$min_width" =~ ^[0-9]+$ ]]; then min_width=0; fi
if ! [[ "$max_width" =~ ^[0-9]+$ ]]; then max_width=0; fi
[[ "$min_width" -eq 0 && "$max_width" -eq 0 ]] && exit 0

tmux list-panes -a -F '#{pane_id} #{pane_width} #{window_panes} #{@switchboard_role}' \
  | awk -v min="$min_width" -v max="$max_width" '
      $4 != "sidebar" { next }
      $3 < 2          { next }   # sidebar parked alone in a window; skip
      {
        target = 0
        if (min > 0 && $2 < min) target = min
        else if (max > 0 && $2 > max) target = max
        if (target > 0 && target != $2) print $1, target
      }' \
  | while read -r pane_id target; do
      tmux resize-pane -t "$pane_id" -x "$target" 2>/dev/null || true
    done

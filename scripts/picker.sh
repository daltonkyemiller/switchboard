#!/usr/bin/env bash
# Open the switchboard file picker in a tmux floating popup, anchored to the
# user's active pane. On selection, the picker sends `@path` to that pane.
# Only opens if the active pane is hosting an agent (claude/codex/opencode)
# or a viewer attached to an agent session.

set -uo pipefail

BINDING_PANE="${1:-${TMUX_PANE:-}}"
SWITCHBOARD_BIN="${SWITCHBOARD_BIN:-switchboard}"

if [[ -z "$BINDING_PANE" ]]; then
  tmux display-message "switchboard pick: no caller pane"
  exit 0
fi

is_agent_pane() {
  local pane="$1"
  local role
  role=$(tmux display-message -t "$pane" -p '#{@switchboard_role}' 2>/dev/null || true)
  if [[ "$role" == "viewer" ]]; then
    return 0
  fi

  # Walk the pane's process tree looking for an agent binary. Covers the case
  # where the user runs `claude` directly in a regular pane without going
  # through `switchboard new`.
  local pid
  pid=$(tmux display-message -t "$pane" -p '#{pane_pid}' 2>/dev/null || true)
  [[ -z "$pid" ]] && return 1

  # Use pgrep -P to find children, scan descendants for agent commands.
  local descendants
  descendants=$(pgrep -P "$pid" 2>/dev/null)
  while IFS= read -r child; do
    [[ -z "$child" ]] && continue
    local cmd
    cmd=$(ps -o comm= -p "$child" 2>/dev/null || true)
    case "$cmd" in
      claude|codex|opencode) return 0 ;;
    esac
    local grandchildren
    grandchildren=$(pgrep -P "$child" 2>/dev/null || true)
    while IFS= read -r grand; do
      [[ -z "$grand" ]] && continue
      cmd=$(ps -o comm= -p "$grand" 2>/dev/null || true)
      case "$cmd" in
        claude|codex|opencode) return 0 ;;
      esac
    done <<< "$grandchildren"
  done <<< "$descendants"

  return 1
}

if ! is_agent_pane "$BINDING_PANE"; then
  exit 0
fi

cwd=$(tmux display-message -t "$BINDING_PANE" -p '#{pane_current_path}' 2>/dev/null || pwd)

tmux display-popup \
  -E \
  -w 90% \
  -h 80% \
  -d "$cwd" \
  -b rounded \
  -T " switchboard pick " \
  "$SWITCHBOARD_BIN pick --target '$BINDING_PANE' --cwd '$cwd'"

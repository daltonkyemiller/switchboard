#!/usr/bin/env bash
# switchboard router — run tmux pane operations in a way that keeps the
# sidebar anchored. Uses break-pane / join-pane to park the sidebar in a
# temporary window during layout operations, so the sidebar PROCESS stays
# alive throughout (no kill/respawn → no OpenTUI re-init → no escape leak).

set -uo pipefail

action="${1:-}"
shift || true
# Second arg is the firing client's pane id, passed explicitly from the
# binding (see plugin.tmux). Falls back to $TMUX_PANE if not provided.
BINDING_PANE="${1:-}"
[[ -n "$BINDING_PANE" ]] && shift || true

LOG_FILE="${TMPDIR:-/tmp}/switchboard-router.log"
log() {
  printf '[%s] %s\n' "$(date +%H:%M:%S.%N)" "$*" >>"$LOG_FILE" 2>/dev/null || true
}
log "ENTER action=$action BINDING_PANE=${BINDING_PANE:-<none>} TMUX_PANE=${TMUX_PANE:-<unset>} pid=$$"
trap 'log "EXIT action=$action code=$?"' EXIT

# Resolve the effective caller pane. When the binding fires from inside a
# nested tmux client viewing an agent session, $TMUX_PANE points at a pane
# inside that agent session — not the outer pane the user is looking at.
# To make routing deterministic regardless of which tmux client fires the
# binding, walk back from "I'm in an agent session" to "the viewer pane in
# the outer window that's attached to this session."
#
# Resolution rules:
#   1. If $TMUX_PANE's session has @switchboard_role=agent, this is the
#      nested case. Look for a pane anywhere with
#      @switchboard_target_session = <our session name>; that's the viewer.
#      Use the viewer pane as the effective caller.
#   2. Otherwise, use $TMUX_PANE as-is.
resolve_caller_pane() {
  local raw session role owner
  # Priority: explicit binding arg → $TMUX_PANE → empty (ambient fallback in callers)
  raw="${BINDING_PANE:-${TMUX_PANE:-}}"
  if [[ -z "$raw" ]]; then
    return
  fi

  session=$(tmux display-message -t "$raw" -p '#{session_name}' 2>/dev/null || true)
  if [[ -z "$session" ]]; then
    printf '%s' "$raw"
    return
  fi

  role=$(tmux show-options -t "$session" -qv '@switchboard_role' 2>/dev/null || true)
  if [[ "$role" != "agent" ]]; then
    printf '%s' "$raw"
    return
  fi

  owner=$(tmux list-panes -a -F '#{pane_id} #{@switchboard_target_session}' 2>/dev/null \
    | awk -v sess="$session" '$2 == sess { print $1; exit }')
  if [[ -n "$owner" ]]; then
    printf '%s' "$owner"
    return
  fi

  # No viewer found; fall back to raw pane so the script still does
  # *something* sensible (operates on the agent session's window).
  printf '%s' "$raw"
}

CALLER_PANE=$(resolve_caller_pane)

# Resolve the "current window" reliably. When invoked via tmux run-shell from a
# binding, $TMUX_PANE is the pane that triggered the binding; its window is
# the one the user is actually looking at. Falls back to tmux's default
# current window if $TMUX_PANE is unset (manual CLI run).
current_window() {
  if [[ -n "$CALLER_PANE" ]]; then
    tmux display-message -t "$CALLER_PANE" -p '#{window_id}' 2>/dev/null || true
  else
    tmux display-message -p '#{window_id}' 2>/dev/null || true
  fi
}

find_sidebar() {
  local win
  win=$(current_window)
  tmux list-panes -t "$win" -F '#{pane_id} #{@switchboard_role}' 2>/dev/null \
    | awk '$2 == "sidebar" { print $1; exit }'
}

active_pane() {
  if [[ -n "$CALLER_PANE" ]]; then
    printf '%s' "$CALLER_PANE"
  else
    tmux display-message -p '#{pane_id}' 2>/dev/null || true
  fi
}

largest_working_pane() {
  local win
  win=$(current_window)
  tmux list-panes -t "$win" -F '#{pane_id} #{pane_width} #{@switchboard_role}' 2>/dev/null \
    | awk '$3 != "sidebar" { print $1, $2 }' \
    | sort -k2 -nr \
    | awk 'NR==1 { print $1 }'
}

sidebar_width() {
  local width
  width=$(tmux show-options -gqv "@switchboard-sidebar-width" 2>/dev/null || true)
  [[ -z "$width" ]] && width=32
  printf '%s' "$width"
}

# Resolve the pane that a split/etc. should target. If the caller is the
# sidebar, picks the largest working pane in the same window. Echoes the
# pane id; returns 1 if no valid target exists.
target_for_action() {
  local active sidebar target
  active=$(active_pane)
  sidebar=$(find_sidebar)

  if [[ -n "$sidebar" && "$active" == "$sidebar" ]]; then
    target=$(largest_working_pane)
    if [[ -z "$target" ]]; then
      return 1
    fi
    printf '%s' "$target"
    return 0
  fi

  printf '%s' "$active"
}

case "$action" in
  split-h)
    target_pane=$(target_for_action) || {
      tmux display-message "switchboard: no working pane to act on"
      exit 0
    }
    log "split-h: caller=$CALLER_PANE target=$target_pane window=$(current_window)"
    tmux split-window -t "$target_pane" -h
    ;;

  split-v)
    target_pane=$(target_for_action) || {
      tmux display-message "switchboard: no working pane to act on"
      exit 0
    }
    log "split-v: caller=$CALLER_PANE target=$target_pane window=$(current_window)"
    tmux split-window -t "$target_pane" -v
    ;;

  next-layout)
    window_target=$(current_window)
    layouts=(even-horizontal even-vertical main-horizontal main-vertical tiled)
    current=$(tmux show-options -t "$window_target" -wqv "@switchboard-layout-cycle" 2>/dev/null || true)
    [[ "$current" =~ ^[0-9]+$ ]] || current=-1
    next_index=$(( (current + 1) % ${#layouts[@]} ))
    target_layout="${layouts[$next_index]}"

    sidebar=$(find_sidebar)
    active=$(active_pane)
    width=$(sidebar_width)

    if [[ -n "$sidebar" ]]; then
      if [[ "$active" == "$sidebar" ]]; then
        active=$(largest_working_pane)
        if [[ -z "$active" ]]; then
          tmux display-message "switchboard: no working pane to act on"
          exit 0
        fi
        tmux select-pane -t "$active"
      fi
      log "next-layout: sidebar=$sidebar active=$active window=$window_target target=$target_layout"
      if ! tmux \
           break-pane -d -s "$sidebar" \; \
           select-layout -t "$window_target" "$target_layout" \; \
           join-pane -fhb -l "$width" -s "$sidebar" -t "$active" \; \
           select-pane -t "$active" \
           2>>"${TMPDIR:-/tmp}/switchboard-router.log"; then
        tmux display-message "switchboard: layout cycle failed; see /tmp/switchboard-router.log"
        log "next-layout FAILED"
        exit 1
      fi
    else
      log "next-layout: no sidebar; window=$window_target target=$target_layout"
      if ! tmux select-layout -t "$window_target" "$target_layout" \
           2>>"${TMPDIR:-/tmp}/switchboard-router.log"; then
        log "next-layout FAILED"
        exit 1
      fi
    fi

    tmux set-option -t "$window_target" -w -q "@switchboard-layout-cycle" "$next_index"
    log "next-layout OK (cycle=$next_index)"
    # Surface the target window/layout so misroutes are visible at a glance.
    # Comment this out once you trust the router.
    tmux display-message "switchboard: $target_layout @ $window_target"
    ;;

  *)
    echo "router: unknown action '$action'" >&2
    exit 1
    ;;
esac

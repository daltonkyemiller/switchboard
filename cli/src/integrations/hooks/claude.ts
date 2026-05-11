export const CLAUDE_HOOK_FILENAME = "switchboard-agent-state.sh";

export const CLAUDE_HOOK_SCRIPT = `#!/bin/sh
# installed by switchboard
# safe to edit. this hook only fires when a switchboard daemon socket exists.
# SWITCHBOARD_INTEGRATION_ID=claude
# SWITCHBOARD_INTEGRATION_VERSION=1

set -eu

action="\${1:-}"
hook_input_file="$(mktemp "\${TMPDIR:-/tmp}/switchboard-claude-hook.XXXXXX")" || exit 0
trap 'rm -f "$hook_input_file"' EXIT HUP INT TERM
cat >"$hook_input_file" 2>/dev/null || true

case "$action" in
  working|idle|blocked|release) ;;
  *) exit 0 ;;
esac

pane_id="\${SWITCHBOARD_PANE_ID:-\${TMUX_PANE:-}}"
[ -n "$pane_id" ] || exit 0

socket_path="\${SWITCHBOARD_SOCKET_PATH:-\${XDG_RUNTIME_DIR:-/tmp}/switchboard/switchboard.sock}"
[ -S "$socket_path" ] || exit 0

command -v python3 >/dev/null 2>&1 || exit 0

SWITCHBOARD_ACTION="$action" \\
SWITCHBOARD_PANE_ID="$pane_id" \\
SWITCHBOARD_SOCKET_PATH="$socket_path" \\
SWITCHBOARD_HOOK_INPUT_FILE="$hook_input_file" \\
SWITCHBOARD_AGENT_PID="\${PPID:-0}" \\
python3 - <<'PY'
import json
import os
import random
import socket
import time

source = "switchboard:claude"
action = os.environ["SWITCHBOARD_ACTION"]
pane_id = os.environ["SWITCHBOARD_PANE_ID"]
socket_path = os.environ["SWITCHBOARD_SOCKET_PATH"]
hook_input_file = os.environ.get("SWITCHBOARD_HOOK_INPUT_FILE", "")
agent_pid = int(os.environ.get("SWITCHBOARD_AGENT_PID", "0") or 0)

hook_input = {}
if hook_input_file:
    try:
        with open(hook_input_file, encoding="utf-8") as handle:
            content = handle.read()
        if content.strip():
            hook_input = json.loads(content)
    except Exception:
        hook_input = {}

is_subagent = bool(hook_input.get("agent_id"))
if is_subagent and action in ("idle", "release"):
    action = "working"

prompt_preview = ""
prompt = hook_input.get("prompt")
if isinstance(prompt, str):
    prompt_preview = " ".join(prompt.split())[:80]

request_id = f"{source}:{int(time.time() * 1000)}:{random.randrange(1_000_000):06d}"
report_seq = time.time_ns()

if action == "release":
    params = {
        "pane_id": pane_id,
        "source": source,
        "agent": "claude",
        "seq": report_seq,
    }
    method = "pane.release_agent"
else:
    params = {
        "pane_id": pane_id,
        "source": source,
        "agent": "claude",
        "state": action,
        "seq": report_seq,
    }
    if agent_pid > 0:
        params["pid"] = agent_pid
    if prompt_preview:
        params["prompt_preview"] = prompt_preview
    method = "pane.report_agent"

request = {"id": request_id, "method": method, "params": params}

try:
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.settimeout(0.5)
    client.connect(socket_path)
    client.sendall((json.dumps(request) + "\\n").encode())
    try:
        client.recv(4096)
    except Exception:
        pass
    client.close()
except Exception:
    pass
PY
`;

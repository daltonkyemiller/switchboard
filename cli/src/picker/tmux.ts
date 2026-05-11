type TmuxResult = { readonly ok: boolean; readonly stdout: string };

async function tmuxCapture(args: readonly string[]): Promise<TmuxResult> {
  const proc = Bun.spawn(["tmux", ...args], { stdout: "pipe", stderr: "ignore" });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { ok: exitCode === 0, stdout: stdout.trim() };
}

// If paneId is a viewer (has @switchboard_target_session set), find the actual
// agent pane inside the nested session and return that pane id. Otherwise
// return paneId unchanged. This lets us send-keys directly to the agent's pty
// without going through the nested tmux client's key-binding layer.
export async function resolveAgentPane(paneId: string): Promise<string> {
  const opt = await tmuxCapture([
    "display-message",
    "-t",
    paneId,
    "-p",
    "#{@switchboard_target_session}",
  ]);
  const targetSession = opt.stdout.trim();
  if (!targetSession) return paneId;

  const panes = await tmuxCapture([
    "list-panes",
    "-t",
    targetSession,
    "-F",
    "#{pane_id}",
  ]);
  if (!panes.ok) return paneId;
  const first = panes.stdout.split("\n").find(Boolean);
  return first ?? paneId;
}

// Send text to a pane as a literal paste, bypassing key-binding interpretation.
// Uses load-buffer + paste-buffer so even bound keys like `@` arrive as input.
export async function pasteToPane(paneId: string, text: string): Promise<void> {
  const bufferName = `switchboard-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const loadProc = Bun.spawn(["tmux", "load-buffer", "-b", bufferName, "-"], {
    stdin: "pipe",
    stdout: "ignore",
    stderr: "ignore",
  });
  loadProc.stdin.write(text);
  await loadProc.stdin.end();
  await loadProc.exited;

  await tmuxCapture(["paste-buffer", "-t", paneId, "-b", bufferName, "-d"]);
}

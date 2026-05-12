import { paths } from "../shared/paths.ts";

type TmuxResult = { readonly ok: boolean; readonly stdout: string };

type PasteTarget = {
  readonly paneId: string;
  readonly server: "outer" | "agent";
};

async function tmuxCapture(
  args: readonly string[],
  server: PasteTarget["server"] = "outer",
): Promise<TmuxResult> {
  const tmuxArgs = server === "agent" ? ["-S", paths.agentTmuxSocket, ...args] : [...args];
  const proc = Bun.spawn(["tmux", ...tmuxArgs], { stdout: "pipe", stderr: "ignore" });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { ok: exitCode === 0, stdout: stdout.trim() };
}

// If paneId is a viewer (has @switchboard_target_session set), find the actual
// agent pane inside the nested session and return that pane id. Otherwise
// return paneId unchanged. This lets us send-keys directly to the agent's pty
// without going through the nested tmux client's key-binding layer.
export async function resolveAgentPane(paneId: string): Promise<PasteTarget> {
  const opt = await tmuxCapture([
    "display-message",
    "-t",
    paneId,
    "-p",
    "#{@switchboard_target_session}",
  ]);
  const targetSession = opt.stdout.trim();
  if (!targetSession) return { paneId, server: "outer" };

  const panes = await tmuxCapture(
    [
      "list-panes",
      "-t",
      targetSession,
      "-F",
      "#{pane_id}",
    ],
    "agent",
  );
  if (!panes.ok) return { paneId, server: "outer" };
  const first = panes.stdout.split("\n").find(Boolean);
  return first ? { paneId: first, server: "agent" } : { paneId, server: "outer" };
}

// Send text to a pane as a literal paste, bypassing key-binding interpretation.
// Uses load-buffer + paste-buffer so even bound keys like `@` arrive as input.
export async function pasteToPane(target: PasteTarget, text: string): Promise<void> {
  const bufferName = `switchboard-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const tmuxPrefix = target.server === "agent" ? ["tmux", "-S", paths.agentTmuxSocket] : ["tmux"];
  const loadProc = Bun.spawn([...tmuxPrefix, "load-buffer", "-b", bufferName, "-"], {
    stdin: "pipe",
    stdout: "ignore",
    stderr: "ignore",
  });
  loadProc.stdin.write(text);
  await loadProc.stdin.end();
  await loadProc.exited;

  await tmuxCapture(["paste-buffer", "-t", target.paneId, "-b", bufferName, "-d"], target.server);
}

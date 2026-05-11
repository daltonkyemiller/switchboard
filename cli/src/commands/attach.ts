const DEFAULT_VIEWER_WIDTH = "80";

type TmuxResult = {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
};

async function tmux(...args: string[]): Promise<TmuxResult> {
  const proc = Bun.spawn(["tmux", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { ok: exitCode === 0, stdout: stdout.trim(), stderr: stderr.trim() };
}

export type AttachOptions = {
  readonly target: string;
  readonly width?: string;
};

export async function attachAgentSession(options: AttachOptions): Promise<string> {
  if (!process.env["TMUX"]) {
    throw new Error("must be inside tmux to attach");
  }

  const exists = await tmux("has-session", "-t", options.target);
  if (!exists.ok) {
    throw new Error(`session not found: ${options.target}`);
  }

  const width = options.width ?? process.env["SWITCHBOARD_VIEWER_WIDTH"] ?? DEFAULT_VIEWER_WIDTH;
  const create = await tmux(
    "split-window",
    "-fh",
    "-l",
    width,
    "-P",
    "-F",
    "#{pane_id}",
    `TMUX= tmux attach-session -t ${options.target}`,
  );
  if (!create.ok) {
    throw new Error(`failed to open viewer: ${create.stderr || "unknown error"}`);
  }

  const paneId = create.stdout;
  await Promise.all([
    tmux("set-option", "-p", "-t", paneId, "-q", "@switchboard_role", "viewer"),
    tmux("set-option", "-p", "-t", paneId, "-q", "@switchboard_target_session", options.target),
  ]);

  return paneId;
}

export async function runAttach(args: readonly string[]): Promise<void> {
  const [target] = args;
  if (!target) {
    console.error("usage: switchboard attach <session>");
    process.exit(1);
  }
  try {
    const paneId = await attachAgentSession({ target });
    console.log(`attached viewer ${paneId} to ${target}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

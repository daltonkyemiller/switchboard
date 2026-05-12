import { paths } from "../shared/paths.ts";
import { agentTmux, shellQuote, switchboardCommand, tmux } from "../shared/tmux.ts";
import { rememberLastAgent } from "../shared/last-agent.ts";

const DEFAULT_VIEWER_WIDTH = "80";
const VIEWER_CLIENT_FLAGS = "active-pane";

export type AttachOptions = {
  readonly target: string;
  readonly width?: string;
  readonly targetPane?: string;
};

export async function attachAgentSession(options: AttachOptions): Promise<string> {
  if (!process.env["TMUX"]) {
    throw new Error("must be inside tmux to attach");
  }

  const exists = await agentTmux(["has-session", "-t", options.target]);
  if (!exists.ok) {
    throw new Error(`session not found: ${options.target}`);
  }
  await Promise.all([
    agentTmux(["set-option", "-t", options.target, "-q", "prefix", "None"]),
    agentTmux(["set-option", "-t", options.target, "-q", "prefix2", "None"]),
    agentTmux([
      "bind-key",
      "-n",
      "@",
      "run-shell",
      "-b",
      `${switchboardCommand()} pick-agent --session '#{session_name}' --cwd '#{pane_current_path}'`,
    ]),
  ]);

  const width = options.width ?? process.env["SWITCHBOARD_VIEWER_WIDTH"] ?? DEFAULT_VIEWER_WIDTH;
  const splitArgs = [
    "split-window",
    "-fh",
    "-l",
    width,
    ...(options.targetPane ? ["-t", options.targetPane] : []),
    "-P",
    "-F",
    "#{pane_id}",
    `TMUX= tmux -S ${shellQuote(paths.agentTmuxSocket)} attach-session -f ${VIEWER_CLIENT_FLAGS} -t ${shellQuote(options.target)}`,
  ];
  const create = await tmux(splitArgs);
  if (!create.ok) {
    throw new Error(`failed to open viewer: ${create.stderr || "unknown error"}`);
  }

  const paneId = create.stdout;
  await Promise.all([
    tmux(["set-option", "-p", "-t", paneId, "-q", "@switchboard_role", "viewer"]),
    tmux(["set-option", "-p", "-t", paneId, "-q", "@switchboard_target_session", options.target]),
  ]);

  const cwd = await agentTmux(["show-options", "-t", options.target, "-qv", "@switchboard_cwd"]);
  if (cwd.ok && cwd.stdout) {
    await rememberLastAgent(cwd.stdout, options.target);
  }

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

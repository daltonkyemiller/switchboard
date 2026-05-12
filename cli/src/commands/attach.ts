import { Result } from "@praha/byethrow";
import { paths } from "../shared/paths.ts";
import { rememberLastAgent } from "../shared/last-agent.ts";
import { fail, fromTmux, type CliResultAsync, unwrapOrExit } from "../shared/result.ts";
import { agentTmux, shellQuote, switchboardCommand, tmux } from "../shared/tmux.ts";

const DEFAULT_VIEWER_WIDTH = "80";
const VIEWER_CLIENT_FLAGS = "active-pane";

export type AttachOptions = {
  readonly target: string;
  readonly width?: string;
  readonly targetPane?: string;
};

export async function attachAgentSession(options: AttachOptions): CliResultAsync<string> {
  if (!process.env["TMUX"]) {
    return fail("must be inside tmux to attach");
  }

  const exists = await agentTmux(["has-session", "-t", options.target]);
  if (!exists.ok) {
    return fail(`session not found: ${options.target}`);
  }
  await Promise.all([
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
  const created = fromTmux(create, "failed to open viewer");
  if (Result.isFailure(created)) return created;

  const paneId = created.value.stdout;
  await Promise.all([
    tmux(["set-option", "-p", "-t", paneId, "-q", "@switchboard_role", "viewer"]),
    tmux(["set-option", "-p", "-t", paneId, "-q", "@switchboard_target_session", options.target]),
  ]);

  const cwd = await agentTmux(["show-options", "-t", options.target, "-qv", "@switchboard_cwd"]);
  if (cwd.ok && cwd.stdout) {
    await rememberLastAgent(cwd.stdout, options.target);
  }

  return Result.succeed(paneId);
}

export async function runAttach(args: readonly string[]): Promise<void> {
  const [target] = args;
  if (!target) {
    console.error("usage: switchboard attach <session>");
    process.exit(1);
  }
  const paneId = unwrapOrExit(await attachAgentSession({ target }));
  console.log(`attached viewer ${paneId} to ${target}`);
}

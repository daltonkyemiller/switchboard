import { attachAgentSession } from "./attach.ts";
import { resolveAgentLauncher } from "../shared/agent-config.ts";
import { connect } from "../shared/client.ts";
import { paths } from "../shared/paths.ts";
import { agentTmux, shellQuote, switchboardCommand } from "../shared/tmux.ts";
import type { Tool } from "../shared/state.ts";

const TOOLS = new Set<Tool>(["claude", "codex", "opencode"]);

export function isTool(value: string): value is Tool {
  return TOOLS.has(value as Tool);
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function generateSessionName(tool: Tool): string {
  const now = new Date();
  const stamp =
    `${pad(now.getFullYear() % 100, 2)}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}` +
    `-${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}${pad(now.getSeconds(), 2)}`;
  const rand = Math.floor(Math.random() * 100_000);
  return `${tool}-${stamp}-${rand}`;
}

async function buildCommandLine(tool: Tool, args: readonly string[]): Promise<string> {
  const launcher = await resolveAgentLauncher(tool);
  return [launcher.command, ...launcher.args.map(shellQuote), ...args.map(shellQuote)].join(" ");
}

export type CreateAgentOptions = {
  readonly tool: Tool;
  readonly args?: readonly string[];
  readonly cwd?: string;
};

export type CreateAgentResult = {
  readonly sessionName: string;
  readonly command: string;
  readonly paneId: string | null;
  readonly notifyError: string | null;
};

type AgentPane = {
  readonly paneId: string;
  readonly panePid: number;
  readonly session: string;
  readonly windowIndex: number;
  readonly windowName: string;
  readonly cwd: string;
};

async function getSessionPane(sessionName: string): Promise<AgentPane | null> {
  const format = [
    "#{pane_id}",
    "#{pane_pid}",
    "#{session_name}",
    "#{window_index}",
    "#{window_name}",
    "#{pane_current_path}",
  ].join("\t");
  const result = await agentTmux(["list-panes", "-t", sessionName, "-F", format]);
  if (!result.ok) return null;

  const [line] = result.stdout.split("\n").filter(Boolean);
  if (!line) return null;

  const parts = line.split("\t");
  if (parts.length < 6) return null;

  const [paneId, panePid, session, windowIndex, windowName, cwd] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const pid = Number.parseInt(panePid, 10);
  const idx = Number.parseInt(windowIndex, 10);
  if (Number.isNaN(pid) || Number.isNaN(idx)) return null;

  return { paneId, panePid: pid, session, windowIndex: idx, windowName, cwd };
}

async function notifyDaemonCreated(tool: Tool, pane: AgentPane): Promise<string | null> {
  try {
    const client = await connect();
    const response = await client.request("pane.report_agent", {
      pane_id: pane.paneId,
      source: `switchboard:new:${tool}`,
      agent: tool,
      state: "unknown",
      seq: Date.now() * 1000,
      tmux_server: "agent",
      pid: pane.panePid,
      cwd: pane.cwd,
      session: pane.session,
      window_index: pane.windowIndex,
      window_name: pane.windowName,
    });
    client.close();

    if ("error" in response) {
      return response.error.message;
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function createAgentSession(
  options: CreateAgentOptions,
): Promise<CreateAgentResult> {
  const cwd = options.cwd ?? process.cwd();
  const sessionName = generateSessionName(options.tool);
  const command = await buildCommandLine(options.tool, options.args ?? []);

  const create = await agentTmux([
    "new-session",
    "-d",
    "-s",
    sessionName,
    "-c",
    cwd,
    "-e",
    "SWITCHBOARD_ENV=1",
    "-e",
    `SWITCHBOARD_SOCKET_PATH=${paths.socket}`,
    command,
  ]);
  if (!create.ok) {
    throw new Error(`failed to create tmux session: ${create.stderr || "unknown error"}`);
  }

  await Promise.all([
    agentTmux(["set-option", "-t", sessionName, "-q", "status", "off"]),
    agentTmux(["set-option", "-t", sessionName, "-q", "@switchboard_role", "agent"]),
    agentTmux(["set-option", "-t", sessionName, "-q", "@switchboard_tool", options.tool]),
    agentTmux(["set-option", "-t", sessionName, "-q", "@switchboard_cwd", cwd]),
    agentTmux(["rename-window", "-t", `${sessionName}:0`, options.tool]),
    agentTmux([
      "bind-key",
      "-n",
      "@",
      "run-shell",
      "-b",
      `${switchboardCommand()} pick-agent --session '#{session_name}' --cwd '#{pane_current_path}'`,
    ]),
  ]);

  const pane = await getSessionPane(sessionName);
  const notifyError = pane ? await notifyDaemonCreated(options.tool, pane) : "agent pane not found";

  return { sessionName, command, paneId: pane?.paneId ?? null, notifyError };
}

export async function runNew(args: readonly string[]): Promise<void> {
  const detachIndex = args.indexOf("--detach");
  const detach = detachIndex >= 0;
  const remaining = detach ? args.filter((_, i) => i !== detachIndex) : args;
  const [tool, ...toolArgs] = remaining;

  if (!tool || !isTool(tool)) {
    console.error("usage: switchboard new <claude|codex|opencode> [--detach] [args...]");
    process.exit(1);
  }

  try {
    const { sessionName, command, notifyError } = await createAgentSession({
      tool,
      args: toolArgs,
    });
    console.log(`created session ${sessionName} running ${command}`);
    if (notifyError) {
      console.error(`warning: created session but could not notify daemon: ${notifyError}`);
    }

    if (detach) return;
    if (!process.env["TMUX"]) {
      console.log("(not inside tmux — skipping viewer attach)");
      return;
    }
    const paneId = await attachAgentSession({ target: sessionName });
    console.log(`attached viewer ${paneId} to ${sessionName}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

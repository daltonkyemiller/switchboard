import { paths } from "../shared/paths.ts";
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

const SAFE_ARG = /^[a-zA-Z0-9_\/=:.@%+,-]+$/;

function shellQuote(value: string): string {
  if (SAFE_ARG.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function buildCommandLine(tool: Tool, args: readonly string[]): string {
  return [tool, ...args].map(shellQuote).join(" ");
}

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

export type CreateAgentOptions = {
  readonly tool: Tool;
  readonly args?: readonly string[];
  readonly cwd?: string;
};

export type CreateAgentResult = {
  readonly sessionName: string;
  readonly command: string;
};

export async function createAgentSession(
  options: CreateAgentOptions,
): Promise<CreateAgentResult> {
  const cwd = options.cwd ?? process.cwd();
  const sessionName = generateSessionName(options.tool);
  const command = buildCommandLine(options.tool, options.args ?? []);

  const create = await tmux(
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
  );
  if (!create.ok) {
    throw new Error(`failed to create tmux session: ${create.stderr || "unknown error"}`);
  }

  await Promise.all([
    tmux("set-option", "-t", sessionName, "-q", "status", "off"),
    tmux("set-option", "-t", sessionName, "-q", "@switchboard_role", "agent"),
    tmux("set-option", "-t", sessionName, "-q", "@switchboard_tool", options.tool),
    tmux("set-option", "-t", sessionName, "-q", "@switchboard_cwd", cwd),
    tmux("rename-window", "-t", `${sessionName}:0`, options.tool),
  ]);

  return { sessionName, command };
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
    const { sessionName, command } = await createAgentSession({ tool, args: toolArgs });
    console.log(`created session ${sessionName} running ${command}`);

    if (detach) return;
    if (!process.env["TMUX"]) {
      console.log("(not inside tmux — skipping switch-client)");
      return;
    }
    await tmux("switch-client", "-t", sessionName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

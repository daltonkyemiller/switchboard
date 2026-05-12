import { access, lstat, mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { paths } from "./paths.ts";

export type TmuxResult = {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
};

const SAFE_ARG = /^[a-zA-Z0-9_\/=:.@%+,-]+$/;

const DEFAULT_AGENT_TMUX_CONFIG = `set -g default-command "\${SHELL}"
set -g prefix None
set -g prefix2 None
unbind-key -a
unbind-key -a -T root
set -g status off
set -g mouse off
set -g pane-border-status off
set -g escape-time 10
set -g focus-events on
set -g default-terminal "tmux-256color"
`;

export async function tmux(args: readonly string[]): Promise<TmuxResult> {
  const proc = Bun.spawn(["tmux", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { ok: exitCode === 0, stdout: stdout.trim(), stderr: stderr.trim() };
}

export function shellQuote(value: string): string {
  if (SAFE_ARG.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function switchboardCommand(): string {
  return shellQuote(process.argv[1] ?? "switchboard");
}

export async function tmuxOption(name: string): Promise<string> {
  const result = await tmux(["show-options", "-gqv", name]);
  return result.ok ? result.stdout : "";
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function cleanupAgentTmuxSocket(): Promise<void> {
  try {
    const stat = await lstat(paths.agentTmuxSocket);
    if (!stat.isSocket()) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  const probe = await tmux(["-S", paths.agentTmuxSocket, "display-message", "-p", "switchboard"]);
  if (probe.ok) return;

  await unlink(paths.agentTmuxSocket).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function ensureAgentTmuxConfig(): Promise<string> {
  if (await fileExists(paths.agentTmuxConfigFile)) {
    return paths.agentTmuxConfigFile;
  }

  await mkdir(dirname(paths.generatedAgentTmuxConfigFile), { recursive: true });
  await writeFile(paths.generatedAgentTmuxConfigFile, DEFAULT_AGENT_TMUX_CONFIG);
  return paths.generatedAgentTmuxConfigFile;
}

export async function agentTmux(args: readonly string[]): Promise<TmuxResult> {
  const config = await ensureAgentTmuxConfig();
  await mkdir(dirname(paths.agentTmuxSocket), { recursive: true });
  await cleanupAgentTmuxSocket();
  return tmux(["-S", paths.agentTmuxSocket, "-f", config, ...args]);
}

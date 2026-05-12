import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { CLAUDE_HOOK_FILENAME } from "../integrations/hooks/claude.ts";
import { CODEX_HOOK_FILENAME } from "../integrations/hooks/codex.ts";
import { OPENCODE_PLUGIN_FILENAME } from "../integrations/hooks/opencode.ts";
import { paths } from "./paths.ts";
import type { Tool } from "./state.ts";

const TOOLS: readonly Tool[] = ["claude", "codex", "opencode"];

type AgentConfig = {
  readonly command: string | null;
  readonly args: readonly string[];
};

export type AgentLauncher = {
  readonly tool: Tool;
  readonly command: string;
  readonly args: readonly string[];
  readonly displayCommand: string;
  readonly configured: boolean;
  readonly installed: boolean;
};

const DEFAULT_AGENT_CONFIG: Record<Tool, AgentConfig> = {
  claude: { command: "claude", args: [] },
  codex: { command: "codex", args: [] },
  opencode: { command: "opencode", args: [] },
};

const home = process.env["HOME"];
if (!home) {
  throw new Error("HOME is not set");
}

const INTEGRATION_FILES: Record<Tool, string> = {
  claude: join(home, ".claude", "hooks", CLAUDE_HOOK_FILENAME),
  codex: join(home, ".codex", CODEX_HOOK_FILENAME),
  opencode: join(home, ".config", "opencode", "plugins", OPENCODE_PLUGIN_FILENAME),
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

async function readConfigRoot(): Promise<Record<string, unknown>> {
  let raw = "";
  try {
    raw = await readFile(paths.configFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const parsed: unknown = raw.trim().length > 0 ? Bun.TOML.parse(raw) : {};
  return isRecord(parsed) ? parsed : {};
}

function parseAgentConfig(root: Record<string, unknown>, tool: Tool): AgentConfig {
  const agents = isRecord(root["agents"]) ? root["agents"] : {};
  const config = isRecord(agents[tool]) ? agents[tool] : {};
  const defaults = DEFAULT_AGENT_CONFIG[tool];
  return {
    command: asString(config["command"]) ?? defaults.command,
    args: asStringArray(config["args"]),
  };
}

export async function resolveAgentLauncher(tool: Tool): Promise<AgentLauncher> {
  const root = await readConfigRoot();
  const config = parseAgentConfig(root, tool);
  const args = config.args.length > 0 ? ` ${config.args.join(" ")}` : "";
  return {
    tool,
    command: config.command ?? tool,
    args: config.args,
    displayCommand: `${config.command ?? tool}${args}`,
    configured: config.command !== DEFAULT_AGENT_CONFIG[tool].command || config.args.length > 0,
    installed: await fileExists(INTEGRATION_FILES[tool]),
  };
}

export async function listAgentLaunchers(): Promise<readonly AgentLauncher[]> {
  const launchers = await Promise.all(TOOLS.map((tool) => resolveAgentLauncher(tool)));
  return launchers;
}

export async function listInstalledAgentLaunchers(): Promise<readonly AgentLauncher[]> {
  const launchers = await listAgentLaunchers();
  return launchers.filter((launcher) => launcher.installed);
}

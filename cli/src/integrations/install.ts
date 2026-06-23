import { Result } from "@praha/byethrow";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cliError, isErrno, type CliResultAsync } from "../shared/result.ts";
import { ensureCodexHooksEnabled } from "./codex-toml.ts";
import { CLAUDE_HOOK_FILENAME, CLAUDE_HOOK_SCRIPT } from "./hooks/claude.ts";
import { CODEX_HOOK_FILENAME, CODEX_HOOK_SCRIPT } from "./hooks/codex.ts";
import { OPENCODE_PLUGIN_FILENAME, OPENCODE_PLUGIN_SCRIPT } from "./hooks/opencode.ts";
import { PI_EXTENSION_FILENAME, PI_EXTENSION_SCRIPT } from "./hooks/pi.ts";
import { ensureCommandHook, shellSingleQuote } from "./settings-patch.ts";

const home = process.env["HOME"];

function homeDir(): string {
  if (!home) throw new Error("HOME is not set");
  return home;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function commandExists(command: string): boolean {
  const result = Bun.spawnSync({
    cmd: ["sh", "-lc", `command -v ${shellSingleQuote(command)} >/dev/null 2>&1`],
  });
  return result.success;
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${path} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return {};
    throw error;
  }
}

export type ClaudeInstallResult = {
  readonly hookPath: string;
  readonly settingsPath: string;
};

async function installClaudeImpl(): Promise<ClaudeInstallResult> {
  const claudeDir = join(homeDir(), ".claude");
  if (!(await isDirectory(claudeDir))) {
    throw new Error(`claude directory not found at ${claudeDir}. install claude code first`);
  }

  const hooksDir = join(claudeDir, "hooks");
  await mkdir(hooksDir, { recursive: true });

  const hookPath = join(hooksDir, CLAUDE_HOOK_FILENAME);
  await writeFile(hookPath, CLAUDE_HOOK_SCRIPT);
  await chmod(hookPath, 0o755);

  const settingsPath = join(claudeDir, "settings.json");
  const settings = await readJson(settingsPath);

  const quoted = shellSingleQuote(hookPath);
  const cmd = (action: string) => `bash ${quoted} ${action}`;

  const events: ReadonlyArray<readonly [string, string]> = [
    ["SessionStart", "idle"],
    ["UserPromptSubmit", "working"],
    ["PreToolUse", "working"],
    ["PermissionRequest", "blocked"],
    ["PostToolUse", "working"],
    ["PostToolUseFailure", "working"],
    ["SubagentStop", "working"],
    ["Stop", "idle"],
    ["SessionEnd", "release"],
  ];
  for (const [event, action] of events) {
    ensureCommandHook(settings, event, cmd(action), { timeout: 10, matcher: "*" }, "claude settings");
  }

  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return { hookPath, settingsPath };
}

export function installClaude(): CliResultAsync<ClaudeInstallResult> {
  return Result.try({
    try: installClaudeImpl,
    catch: (error) => cliError("failed to install claude integration", error),
  });
}

export type CodexInstallResult = {
  readonly hookPath: string;
  readonly hooksPath: string;
  readonly configPath: string;
};

async function installCodexImpl(): Promise<CodexInstallResult> {
  const codexDir = join(homeDir(), ".codex");
  if (!(await isDirectory(codexDir))) {
    throw new Error(`codex directory not found at ${codexDir}. install codex first`);
  }

  const hookPath = join(codexDir, CODEX_HOOK_FILENAME);
  await writeFile(hookPath, CODEX_HOOK_SCRIPT);
  await chmod(hookPath, 0o755);

  const hooksPath = join(codexDir, "hooks.json");
  const hooksFile = await readJson(hooksPath);

  const quoted = shellSingleQuote(hookPath);
  const cmd = (action: string) => `bash ${quoted} ${action}`;

  const events: ReadonlyArray<readonly [string, string]> = [
    ["SessionStart", "idle"],
    ["UserPromptSubmit", "working"],
    ["PreToolUse", "working"],
    ["Stop", "idle"],
  ];
  for (const [event, action] of events) {
    ensureCommandHook(hooksFile, event, cmd(action), { timeout: 10 }, "codex hooks file");
  }

  await writeFile(hooksPath, `${JSON.stringify(hooksFile, null, 2)}\n`);

  const configPath = join(codexDir, "config.toml");
  let existing = "";
  try {
    existing = await readFile(configPath, "utf8");
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
  }
  const next = ensureCodexHooksEnabled(existing);
  if (next !== existing) {
    await writeFile(configPath, next);
  }

  return { hookPath, hooksPath, configPath };
}

export function installCodex(): CliResultAsync<CodexInstallResult> {
  return Result.try({
    try: installCodexImpl,
    catch: (error) => cliError("failed to install codex integration", error),
  });
}

export type OpencodeInstallResult = {
  readonly pluginPath: string;
};

async function installOpencodeImpl(): Promise<OpencodeInstallResult> {
  const opencodeDir = join(homeDir(), ".config", "opencode");
  if (!(await isDirectory(opencodeDir))) {
    throw new Error(
      `opencode config directory not found at ${opencodeDir}. install opencode first`,
    );
  }

  const pluginsDir = join(opencodeDir, "plugins");
  await mkdir(pluginsDir, { recursive: true });

  const pluginPath = join(pluginsDir, OPENCODE_PLUGIN_FILENAME);
  await writeFile(pluginPath, OPENCODE_PLUGIN_SCRIPT);
  return { pluginPath };
}

export function installOpencode(): CliResultAsync<OpencodeInstallResult> {
  return Result.try({
    try: installOpencodeImpl,
    catch: (error) => cliError("failed to install opencode integration", error),
  });
}

export type PiInstallResult = {
  readonly extensionPath: string;
};

async function installPiImpl(): Promise<PiInstallResult> {
  const piDir = join(homeDir(), ".pi");
  if (!(await isDirectory(piDir)) && !commandExists("pi")) {
    throw new Error(`pi directory not found at ${piDir}. install pi first`);
  }

  const agentDir = process.env["PI_CODING_AGENT_DIR"] ?? join(piDir, "agent");
  const extensionsDir = join(agentDir, "extensions");
  await mkdir(extensionsDir, { recursive: true });

  const extensionPath = join(extensionsDir, PI_EXTENSION_FILENAME);
  await writeFile(extensionPath, PI_EXTENSION_SCRIPT);
  return { extensionPath };
}

export function installPi(): CliResultAsync<PiInstallResult> {
  return Result.try({
    try: installPiImpl,
    catch: (error) => cliError("failed to install pi integration", error),
  });
}

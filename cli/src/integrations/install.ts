import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureCodexHooksEnabled } from "./codex-toml.ts";
import { CLAUDE_HOOK_FILENAME, CLAUDE_HOOK_SCRIPT } from "./hooks/claude.ts";
import { CODEX_HOOK_FILENAME, CODEX_HOOK_SCRIPT } from "./hooks/codex.ts";
import { OPENCODE_PLUGIN_FILENAME, OPENCODE_PLUGIN_SCRIPT } from "./hooks/opencode.ts";
import { ensureCommandHook, shellSingleQuote } from "./settings-patch.ts";

const home = process.env["HOME"];
if (!home) throw new Error("HOME is not set");

const claudeDir = join(home, ".claude");
const codexDir = join(home, ".codex");
const opencodeDir = join(home, ".config", "opencode");

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
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
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export type ClaudeInstallResult = {
  readonly hookPath: string;
  readonly settingsPath: string;
};

export async function installClaude(): Promise<ClaudeInstallResult> {
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

export type CodexInstallResult = {
  readonly hookPath: string;
  readonly hooksPath: string;
  readonly configPath: string;
};

export async function installCodex(): Promise<CodexInstallResult> {
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
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const next = ensureCodexHooksEnabled(existing);
  if (next !== existing) {
    await writeFile(configPath, next);
  }

  return { hookPath, hooksPath, configPath };
}

export type OpencodeInstallResult = {
  readonly pluginPath: string;
};

export async function installOpencode(): Promise<OpencodeInstallResult> {
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

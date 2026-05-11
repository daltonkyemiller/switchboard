import { installClaude, installCodex, installOpencode } from "../integrations/install.ts";

type Tool = "claude" | "codex" | "opencode";

function isTool(value: string): value is Tool {
  return value === "claude" || value === "codex" || value === "opencode";
}

async function runInstall(tool: Tool): Promise<void> {
  switch (tool) {
    case "claude": {
      const { hookPath, settingsPath } = await installClaude();
      console.log(`installed claude integration hook to ${hookPath}`);
      console.log(`ensured claude settings at ${settingsPath}`);
      return;
    }
    case "codex": {
      const { hookPath, hooksPath, configPath } = await installCodex();
      console.log(`installed codex integration hook to ${hookPath}`);
      console.log(`ensured codex hooks at ${hooksPath}`);
      console.log(`ensured codex config at ${configPath}`);
      return;
    }
    case "opencode": {
      const { pluginPath } = await installOpencode();
      console.log(`installed opencode integration plugin to ${pluginPath}`);
      return;
    }
  }
}

export async function runIntegration(args: readonly string[]): Promise<void> {
  const [sub, target] = args;
  if (sub !== "install") {
    console.error("usage: switchboard integration install <claude|codex|opencode>");
    process.exit(1);
  }
  if (!target || !isTool(target)) {
    console.error("usage: switchboard integration install <claude|codex|opencode>");
    process.exit(1);
  }
  try {
    await runInstall(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`failed: ${message}`);
    process.exit(1);
  }
}

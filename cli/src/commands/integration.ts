import { Result } from "@praha/byethrow";
import { installClaude, installCodex, installOpencode } from "../integrations/install.ts";

type Tool = "claude" | "codex" | "opencode";

function isTool(value: string): value is Tool {
  return value === "claude" || value === "codex" || value === "opencode";
}

async function runInstall(tool: Tool): Promise<void> {
  switch (tool) {
    case "claude": {
      const result = await installClaude();
      if (Result.isFailure(result)) {
        console.error(`failed: ${result.error.message}`);
        process.exit(1);
      }
      const { hookPath, settingsPath } = result.value;
      console.log(`installed claude integration hook to ${hookPath}`);
      console.log(`ensured claude settings at ${settingsPath}`);
      return;
    }
    case "codex": {
      const result = await installCodex();
      if (Result.isFailure(result)) {
        console.error(`failed: ${result.error.message}`);
        process.exit(1);
      }
      const { hookPath, hooksPath, configPath } = result.value;
      console.log(`installed codex integration hook to ${hookPath}`);
      console.log(`ensured codex hooks at ${hooksPath}`);
      console.log(`ensured codex config at ${configPath}`);
      return;
    }
    case "opencode": {
      const result = await installOpencode();
      if (Result.isFailure(result)) {
        console.error(`failed: ${result.error.message}`);
        process.exit(1);
      }
      const { pluginPath } = result.value;
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
  await runInstall(target);
}

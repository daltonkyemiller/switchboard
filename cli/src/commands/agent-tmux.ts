import { reloadAgentTmuxConfig } from "../shared/tmux.ts";

export async function runAgentTmux(args: readonly string[]): Promise<void> {
  const [subcommand] = args;
  if (subcommand !== "reload") {
    console.error("usage: switchboard agent-tmux reload");
    process.exit(1);
  }

  const result = await reloadAgentTmuxConfig();
  if (!result.ok) {
    console.error(result.stderr || "failed to reload agent tmux config");
    process.exit(1);
  }

  console.log(`reloaded ${result.configPath}`);
}

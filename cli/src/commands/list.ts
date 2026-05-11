import { connect } from "../shared/client.ts";
import type { AgentState } from "../shared/state.ts";

const STATUS_COLOR: Record<AgentState["status"], string> = {
  working: "\x1b[33m●\x1b[0m",
  idle: "\x1b[32m○\x1b[0m",
  blocked: "\x1b[31m◆\x1b[0m",
  unknown: "\x1b[90m·\x1b[0m",
};

function formatRow(state: AgentState): string {
  const icon = STATUS_COLOR[state.status];
  const tool = state.tool.padEnd(8);
  const status = state.status.padEnd(8);
  const session = `${state.session}:${state.windowIndex}`.padEnd(20);
  const preview = state.promptPreview ?? "";
  return `${icon} ${state.paneId.padEnd(6)} ${tool} ${status} ${session} ${preview}`;
}

export async function runList(filterCwd: string | null): Promise<void> {
  const client = await connect();
  const response = await client.request("state.list", {});
  client.close();

  if ("error" in response) {
    console.error(`error: ${response.error.message}`);
    process.exit(1);
  }

  const result = response.result as { agents: readonly AgentState[] };
  const agents = filterCwd
    ? result.agents.filter((a) => a.cwd === filterCwd)
    : result.agents;

  if (agents.length === 0) {
    console.log(filterCwd ? "no agents in this cwd" : "no agents");
    return;
  }

  for (const agent of agents) {
    console.log(formatRow(agent));
  }
}

import { connect } from "../shared/client.ts";
import type { AgentStatus, Tool } from "../shared/state.ts";

const TOOLS = new Set<Tool>(["claude", "codex", "opencode"]);
const STATUSES = new Set<AgentStatus>(["working", "idle", "blocked", "unknown"]);

function isTool(value: string): value is Tool {
  return TOOLS.has(value as Tool);
}

function isStatus(value: string): value is AgentStatus {
  return STATUSES.has(value as AgentStatus);
}

export async function runReport(args: readonly string[]): Promise<void> {
  const [tool, status] = args;
  if (!tool || !status || !isTool(tool) || !isStatus(status)) {
    console.error("usage: switchboard report <claude|codex|opencode> <working|idle|blocked|unknown>");
    process.exit(1);
  }

  const paneId = process.env["SWITCHBOARD_PANE_ID"] ?? process.env["TMUX_PANE"];
  if (!paneId) {
    console.error("not in a tmux pane (TMUX_PANE unset)");
    process.exit(1);
  }

  const client = await connect();
  const response = await client.request("pane.report_agent", {
    pane_id: paneId,
    source: `switchboard:report:${tool}`,
    agent: tool,
    state: status,
    seq: Date.now() * 1000,
    pid: process.ppid,
  });
  client.close();

  if ("error" in response) {
    console.error(`error: ${response.error.message}`);
    process.exit(1);
  }
  console.log(`reported ${tool} ${status} for ${paneId}`);
}

export async function runRelease(): Promise<void> {
  const paneId = process.env["SWITCHBOARD_PANE_ID"] ?? process.env["TMUX_PANE"];
  if (!paneId) {
    console.error("not in a tmux pane (TMUX_PANE unset)");
    process.exit(1);
  }

  const client = await connect();
  const response = await client.request("pane.release_agent", {
    pane_id: paneId,
    source: "switchboard:report",
    agent: "claude",
    seq: Date.now() * 1000,
  });
  client.close();

  if ("error" in response) {
    console.error(`error: ${response.error.message}`);
    process.exit(1);
  }
  console.log(`released ${paneId}`);
}

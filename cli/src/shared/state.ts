export type Tool = "claude" | "codex" | "opencode";

export type AgentStatus = "working" | "idle" | "blocked" | "unknown";

export type TmuxServer = "agent" | "outer";

export type AgentState = {
  readonly paneId: string;
  readonly tool: Tool;
  readonly status: AgentStatus;
  readonly tmuxServer: TmuxServer;
  readonly cwd: string;
  readonly pid: number | null;
  readonly promptPreview: string | null;
  readonly session: string;
  readonly windowIndex: number;
  readonly windowName: string;
  readonly updatedAt: number;
  readonly seq: number;
};

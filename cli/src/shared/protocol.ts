import type { AgentState, AgentStatus, Tool } from "./state.ts";

export type ReportAgentParams = {
  readonly pane_id: string;
  readonly source: string;
  readonly agent: Tool;
  readonly state: AgentStatus;
  readonly seq: number;
  readonly tmux_server?: "agent" | "outer";
  readonly pid?: number;
  readonly prompt_preview?: string;
  readonly cwd?: string;
  readonly session?: string;
  readonly window_index?: number;
  readonly window_name?: string;
};

export type ReleaseAgentParams = {
  readonly pane_id: string;
  readonly source: string;
  readonly agent: Tool;
  readonly seq: number;
};

export type SubscribeParams = Record<string, never>;

export type Request =
  | { readonly id: string; readonly method: "pane.report_agent"; readonly params: ReportAgentParams }
  | { readonly id: string; readonly method: "pane.release_agent"; readonly params: ReleaseAgentParams }
  | { readonly id: string; readonly method: "events.subscribe"; readonly params: SubscribeParams }
  | { readonly id: string; readonly method: "state.list"; readonly params: SubscribeParams };

export type ResponseOk = { readonly id: string; readonly result: unknown };
export type ResponseError = {
  readonly id: string;
  readonly error: { readonly code: number; readonly message: string };
};
export type Response = ResponseOk | ResponseError;

export type Event =
  | { readonly type: "agent.updated"; readonly state: AgentState }
  | { readonly type: "agent.removed"; readonly paneId: string };

export type Envelope = Request | Response | { readonly event: Event };

export const PROTOCOL_VERSION = 1;

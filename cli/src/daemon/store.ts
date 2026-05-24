import type { AgentState } from "../shared/state.ts";
import type { Event } from "../shared/protocol.ts";
import type { NvimContextPayload } from "../shared/nvim-context.ts";

type Subscriber = (event: Event) => void;

const states = new Map<string, AgentState>();
const nvimContexts = new Map<string, NvimContextPayload>();
const subscribers = new Set<Subscriber>();

function nvimContextKey(cwd: string, tmuxPane: string | undefined): string {
  return `${cwd}\0${tmuxPane ?? ""}`;
}

function broadcast(event: Event): void {
  for (const sub of subscribers) {
    sub(event);
  }
}

export function upsert(state: AgentState): void {
  const previous = states.get(state.paneId);
  if (previous && previous.seq > state.seq) return;
  states.set(state.paneId, state);
  broadcast({ type: "agent.updated", state });
}

export function remove(paneId: string): void {
  if (!states.has(paneId)) return;
  states.delete(paneId);
  broadcast({ type: "agent.removed", paneId });
}

export function snapshot(): readonly AgentState[] {
  return [...states.values()];
}

export function get(paneId: string): AgentState | undefined {
  return states.get(paneId);
}

export function upsertNvimContext(context: NvimContextPayload): void {
  nvimContexts.set(nvimContextKey(context.cwd, context.tmux_pane), context);
}

export function removeNvimContext(cwd: string, tmuxPane: string | undefined): void {
  nvimContexts.delete(nvimContextKey(cwd, tmuxPane));
}

export function nvimContextForCwd(cwd: string): NvimContextPayload | null {
  const matches = [...nvimContexts.values()]
    .filter((context) => context.cwd === cwd)
    .sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
  return matches[0] ?? null;
}

export function subscribe(handler: Subscriber): () => void {
  subscribers.add(handler);
  for (const state of states.values()) {
    handler({ type: "agent.updated", state });
  }
  return () => subscribers.delete(handler);
}

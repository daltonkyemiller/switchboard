import type { AgentState } from "../shared/state.ts";
import type { Event } from "../shared/protocol.ts";

type Subscriber = (event: Event) => void;

const states = new Map<string, AgentState>();
const subscribers = new Set<Subscriber>();

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

export function subscribe(handler: Subscriber): () => void {
  subscribers.add(handler);
  for (const state of states.values()) {
    handler({ type: "agent.updated", state });
  }
  return () => subscribers.delete(handler);
}

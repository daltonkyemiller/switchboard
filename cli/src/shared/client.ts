import type { Socket } from "bun";
import { paths } from "./paths.ts";
import type { Event, Request, Response } from "./protocol.ts";

type ClientState = {
  buffer: string;
  pending: Map<string, (response: Response) => void>;
  onEvent: ((event: Event) => void) | null;
};

export type Client = {
  request: (method: Request["method"], params: object) => Promise<Response>;
  onEvent: (handler: (event: Event) => void) => void;
  close: () => void;
};

function nextId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function processLine(state: ClientState, line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (typeof parsed !== "object" || parsed === null) return;
  const obj = parsed as Record<string, unknown>;
  if ("event" in obj && state.onEvent) {
    state.onEvent(obj["event"] as Event);
    return;
  }
  if (typeof obj["id"] === "string") {
    const resolver = state.pending.get(obj["id"]);
    if (resolver) {
      state.pending.delete(obj["id"]);
      resolver(parsed as Response);
    }
  }
}

export async function connect(): Promise<Client> {
  const state: ClientState = {
    buffer: "",
    pending: new Map(),
    onEvent: null,
  };

  const socket: Socket<ClientState> = await Bun.connect<ClientState>({
    unix: paths.socket,
    socket: {
      open(s) {
        s.data = state;
      },
      data(s, chunk) {
        s.data.buffer += chunk.toString();
        let newlineIndex = s.data.buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = s.data.buffer.slice(0, newlineIndex);
          s.data.buffer = s.data.buffer.slice(newlineIndex + 1);
          processLine(s.data, line);
          newlineIndex = s.data.buffer.indexOf("\n");
        }
      },
      close() {
        for (const resolver of state.pending.values()) {
          resolver({ id: "", error: { code: -1, message: "connection closed" } });
        }
        state.pending.clear();
      },
    },
  });

  return {
    request(method, params) {
      const id = nextId();
      return new Promise<Response>((resolve) => {
        state.pending.set(id, resolve);
        socket.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    },
    onEvent(handler) {
      state.onEvent = handler;
    },
    close() {
      socket.end();
    },
  };
}

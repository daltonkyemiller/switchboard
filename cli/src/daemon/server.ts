import { mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { Socket } from "bun";
import { paths } from "../shared/paths.ts";
import { cleanupAgentTmuxSocket } from "../shared/tmux.ts";
import type {
  Event,
  ReleaseAgentParams,
  ReportAgentParams,
  Request,
  Response,
} from "../shared/protocol.ts";
import type { AgentState } from "../shared/state.ts";
import * as store from "./store.ts";
import { paneInfo } from "./tmux.ts";

type ConnState = {
  buffer: string;
  unsubscribe: (() => void) | null;
};

function send(socket: Socket<ConnState>, value: Response | { event: Event }): void {
  socket.write(`${JSON.stringify(value)}\n`);
}

function ok(id: string, result: unknown): Response {
  return { id, result };
}

function fail(id: string, message: string, code = -1): Response {
  return { id, error: { code, message } };
}

async function buildState(params: ReportAgentParams): Promise<AgentState> {
  const tmuxServer = params.tmux_server ?? "agent";
  const info = await paneInfo(params.pane_id, tmuxServer);
  return {
    paneId: params.pane_id,
    tool: params.agent,
    status: params.state,
    tmuxServer,
    cwd: params.cwd ?? info?.cwd ?? "",
    pid: params.pid ?? info?.panePid ?? null,
    promptPreview: params.prompt_preview ?? null,
    session: params.session ?? info?.session ?? "",
    windowIndex: params.window_index ?? info?.windowIndex ?? -1,
    windowName: params.window_name ?? info?.windowName ?? "",
    updatedAt: Date.now(),
    seq: params.seq,
  };
}

async function handleReport(params: ReportAgentParams): Promise<void> {
  const existing = store.get(params.pane_id);
  const next = await buildState(params);
  store.upsert(
    existing
      ? {
          ...existing,
          status: next.status,
          tool: next.tool,
          tmuxServer: next.tmuxServer,
          pid: next.pid ?? existing.pid,
          promptPreview: next.promptPreview ?? existing.promptPreview,
          updatedAt: next.updatedAt,
          seq: next.seq,
          cwd: next.cwd || existing.cwd,
          session: next.session || existing.session,
          windowIndex: next.windowIndex >= 0 ? next.windowIndex : existing.windowIndex,
          windowName: next.windowName || existing.windowName,
        }
      : next,
  );
}

function handleRelease(params: ReleaseAgentParams): void {
  store.remove(params.pane_id);
}

async function dispatch(socket: Socket<ConnState>, request: Request): Promise<void> {
  switch (request.method) {
    case "pane.report_agent":
      await handleReport(request.params);
      send(socket, ok(request.id, { accepted: true }));
      return;
    case "pane.release_agent":
      handleRelease(request.params);
      send(socket, ok(request.id, { accepted: true }));
      return;
    case "state.list":
      send(socket, ok(request.id, { agents: store.snapshot() }));
      return;
    case "events.subscribe": {
      if (socket.data.unsubscribe) {
        send(socket, fail(request.id, "already subscribed"));
        return;
      }
      socket.data.unsubscribe = store.subscribe((event) => {
        send(socket, { event });
      });
      send(socket, ok(request.id, { subscribed: true }));
      return;
    }
  }
}

function parseRequest(line: string): Request | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj["id"] !== "string") return null;
    if (typeof obj["method"] !== "string") return null;
    return parsed as Request;
  } catch {
    return null;
  }
}

async function handleLine(socket: Socket<ConnState>, line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;
  const request = parseRequest(trimmed);
  if (!request) {
    send(socket, fail("", "malformed request"));
    return;
  }
  try {
    await dispatch(socket, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "internal error";
    send(socket, fail(request.id, message));
  }
}

async function ensureSocketFree(): Promise<void> {
  try {
    const probe = await Bun.connect({ unix: paths.socket, socket: { data() {} } });
    probe.end();
    throw new Error(`daemon already running on ${paths.socket}`);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ECONNREFUSED") {
      await unlink(paths.socket).catch(() => {});
      return;
    }
    throw error;
  }
}

export async function startServer(): Promise<() => Promise<void>> {
  await mkdir(dirname(paths.socket), { recursive: true });
  await mkdir(dirname(paths.agentsSnapshot), { recursive: true });
  await cleanupAgentTmuxSocket();
  await ensureSocketFree();

  const server = Bun.listen<ConnState>({
    unix: paths.socket,
    socket: {
      open(socket) {
        socket.data = { buffer: "", unsubscribe: null };
      },
      data(socket, chunk) {
        socket.data.buffer += chunk.toString();
        let newlineIndex = socket.data.buffer.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = socket.data.buffer.slice(0, newlineIndex);
          socket.data.buffer = socket.data.buffer.slice(newlineIndex + 1);
          void handleLine(socket, line);
          newlineIndex = socket.data.buffer.indexOf("\n");
        }
      },
      close(socket) {
        socket.data.unsubscribe?.();
      },
      error(socket, error) {
        socket.data.unsubscribe?.();
        console.error("socket error", error);
      },
    },
  });

  return async () => {
    server.stop();
    await unlink(paths.socket).catch(() => {});
  };
}

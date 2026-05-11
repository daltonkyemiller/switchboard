import { useEffect, useMemo, useState } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { attachAgentSession } from "../commands/attach.ts";
import { createAgentSession } from "../commands/new.ts";
import { connect, type Client } from "../shared/client.ts";
import type { Event } from "../shared/protocol.ts";
import type { AgentState, AgentStatus } from "../shared/state.ts";

const STATUS_GLYPH: Record<AgentStatus, string> = {
  working: "●",
  idle: "○",
  blocked: "◆",
  unknown: "·",
};

const STATUS_COLOR: Record<AgentStatus, string> = {
  working: "#fabd2f",
  idle: "#b8bb26",
  blocked: "#fb4934",
  unknown: "#928374",
};

type ConnectionState =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "error"; message: string };

function applyEvent(prev: Map<string, AgentState>, event: Event): Map<string, AgentState> {
  const next = new Map(prev);
  if (event.type === "agent.updated") {
    next.set(event.state.paneId, event.state);
  } else {
    next.delete(event.paneId);
  }
  return next;
}

function focusPane(agent: AgentState): void {
  if (agent.session) {
    Bun.spawn(["tmux", "switch-client", "-t", agent.session], { stderr: "ignore" });
  }
  Bun.spawn(["tmux", "select-window", "-t", agent.paneId], { stderr: "ignore" });
  Bun.spawn(["tmux", "select-pane", "-t", agent.paneId], { stderr: "ignore" });
}

type SidebarProps = {
  readonly filterCwd: string | null;
};

export function SidebarApp({ filterCwd }: SidebarProps) {
  const renderer = useRenderer();
  const [agents, setAgents] = useState<Map<string, AgentState>>(new Map());
  const [connection, setConnection] = useState<ConnectionState>({ kind: "connecting" });
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      [...agents.values()]
        .filter((a) => (filterCwd ? a.cwd === filterCwd : true))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [agents, filterCwd],
  );

  useEffect(() => {
    if (visible.length === 0) {
      if (selectedPaneId !== null) setSelectedPaneId(null);
      return;
    }
    if (!selectedPaneId || !visible.some((a) => a.paneId === selectedPaneId)) {
      setSelectedPaneId(visible[0]?.paneId ?? null);
    }
  }, [visible, selectedPaneId]);

  useKeyboard((key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      renderer.destroy();
      process.exit(0);
      return;
    }
    if (visible.length === 0) return;

    const currentIndex = visible.findIndex((a) => a.paneId === selectedPaneId);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;

    if (key.name === "j" || key.name === "down") {
      const next = visible[Math.min(safeIndex + 1, visible.length - 1)];
      if (next) setSelectedPaneId(next.paneId);
      return;
    }
    if (key.name === "k" || key.name === "up") {
      const next = visible[Math.max(safeIndex - 1, 0)];
      if (next) setSelectedPaneId(next.paneId);
      return;
    }
    if (key.name === "g") {
      const first = visible[0];
      if (first) setSelectedPaneId(first.paneId);
      return;
    }
    if (key.name === "G") {
      const last = visible[visible.length - 1];
      if (last) setSelectedPaneId(last.paneId);
      return;
    }
    if (key.name === "return") {
      const selected = visible[safeIndex];
      if (selected) focusPane(selected);
      return;
    }
    if (key.name === "a") {
      const selected = visible[safeIndex];
      if (selected?.session) {
        void attachAgentSession({ target: selected.session }).catch(() => {});
      }
      return;
    }
    if (key.name === "n") {
      void createAgentSession({ tool: "claude" }).catch(() => {});
      return;
    }
  });

  useEffect(() => {
    let cancelled = false;
    let client: Client | null = null;

    const start = async () => {
      try {
        client = await connect();
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "connection failed";
          setConnection({ kind: "error", message });
        }
        return;
      }
      if (cancelled) {
        client.close();
        return;
      }
      client.onEvent((event) => {
        setAgents((prev) => applyEvent(prev, event));
      });
      const response = await client.request("events.subscribe", {});
      if (cancelled) return;
      if ("error" in response) {
        setConnection({ kind: "error", message: response.error.message });
        return;
      }
      setConnection({ kind: "connected" });
    };

    void start();
    return () => {
      cancelled = true;
      client?.close();
    };
  }, []);

  return (
    <box style={{ flexDirection: "column", padding: 1, flexGrow: 1 }}>
      <Header connection={connection} filterCwd={filterCwd} />
      <box style={{ flexDirection: "column", marginTop: 1, flexGrow: 1 }}>
        {visible.length === 0 ? (
          <text fg="#665c54">no agents{filterCwd ? " in this cwd" : ""}</text>
        ) : (
          visible.map((agent) => (
            <AgentRow
              key={agent.paneId}
              agent={agent}
              selected={agent.paneId === selectedPaneId}
            />
          ))
        )}
      </box>
      <text fg="#665c54">j/k · enter reveal · a attach · n new · q quit</text>
    </box>
  );
}

function Header({
  connection,
  filterCwd,
}: {
  readonly connection: ConnectionState;
  readonly filterCwd: string | null;
}) {
  if (connection.kind === "connecting") {
    return <text fg="#928374">connecting…</text>;
  }
  if (connection.kind === "error") {
    return <text fg="#fb4934">error: {connection.message}</text>;
  }
  return <text fg="#928374">agents{filterCwd ? ` · ${filterCwd}` : ""}</text>;
}

function AgentRow({
  agent,
  selected,
}: {
  readonly agent: AgentState;
  readonly selected: boolean;
}) {
  const location =
    agent.session && agent.windowIndex >= 0 ? `${agent.session}:${agent.windowIndex}` : "";
  const preview = agent.promptPreview ?? "";
  const pointer = selected ? "▍" : " ";
  const pointerColor = selected ? STATUS_COLOR[agent.status] : "#3c3836";
  const nameColor = selected ? "#ebdbb2" : "#a89984";
  const statusColor = STATUS_COLOR[agent.status];
  const background = selected ? "#3c3836" : "#1d2021";

  return (
    <box
      style={{
        flexDirection: "column",
        marginBottom: 1,
        paddingTop: 0,
        paddingBottom: 0,
        paddingLeft: 1,
        paddingRight: 1,
        width: "100%",
        backgroundColor: background,
      }}
    >
      <box style={{ flexDirection: "row" }}>
        <text fg={pointerColor}>{pointer} </text>
        <text fg={statusColor}>{STATUS_GLYPH[agent.status]} </text>
        <text fg={nameColor}>{agent.tool} </text>
        <text fg="#928374">{agent.status}</text>
      </box>
      {location ? (
        <box style={{ flexDirection: "row", paddingLeft: 4 }}>
          <text fg="#665c54">{location}</text>
        </box>
      ) : null}
      {preview ? (
        <box style={{ flexDirection: "row", paddingLeft: 4 }}>
          <text fg="#7c6f64">{truncate(preview, 60)}</text>
        </box>
      ) : null}
    </box>
  );
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

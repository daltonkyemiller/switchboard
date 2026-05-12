import { useEffect, useMemo, useState } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { attachAgentSession } from "../commands/attach.ts";
import { connect, type Client } from "../shared/client.ts";
import type { Event } from "../shared/protocol.ts";
import type { AgentState, AgentStatus } from "../shared/state.ts";
import { switchboardBinary } from "../shared/tmux.ts";

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

type SidebarTab = "cwd" | "all";

const SIDEBAR_TABS: readonly SidebarTab[] = ["cwd", "all"];

type AgentGroup = {
  readonly cwd: string;
  readonly agents: readonly AgentState[];
};

type SidebarDensity = "dense" | "normal" | "loose";

type SidebarSpacing = {
  readonly group: number;
  readonly row: number;
};

const SIDEBAR_SPACING: Record<SidebarDensity, SidebarSpacing> = {
  dense: { group: 1, row: 0 },
  normal: { group: 1, row: 1 },
  loose: { group: 2, row: 1 },
};

function applyEvent(prev: Map<string, AgentState>, event: Event): Map<string, AgentState> {
  const next = new Map(prev);
  if (event.type === "agent.updated") {
    next.set(event.state.paneId, event.state);
  } else {
    next.delete(event.paneId);
  }
  return next;
}

async function attachAgent(agent: AgentState): Promise<void> {
  if (!agent.session) return;
  await attachAgentSession({ target: agent.session });
}

type SidebarProps = {
  readonly filterCwd: string | null;
};

async function getTmuxOption(name: string): Promise<string> {
  const proc = Bun.spawn(["tmux", "show-options", "-gqv", name], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text.trim();
}

export function SidebarApp({ filterCwd }: SidebarProps) {
  const renderer = useRenderer();
  const [agents, setAgents] = useState<Map<string, AgentState>>(new Map());
  const [connection, setConnection] = useState<ConnectionState>({ kind: "connecting" });
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [density, setDensity] = useState<SidebarDensity>("dense");
  const [activeTab, setActiveTab] = useState<SidebarTab>(filterCwd ? "cwd" : "all");
  const activeFilterCwd = activeTab === "cwd" ? filterCwd : null;
  const spacing = SIDEBAR_SPACING[density];

  const visible = useMemo(
    () =>
      [...agents.values()]
        .filter((a) => (activeFilterCwd ? a.cwd === activeFilterCwd : true))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [agents, activeFilterCwd],
  );
  const groups = useMemo(() => groupAgentsByCwd(visible), [visible]);

  useEffect(() => {
    if (visible.length === 0) {
      if (selectedPaneId !== null) setSelectedPaneId(null);
      return;
    }
    if (!selectedPaneId || !visible.some((a) => a.paneId === selectedPaneId)) {
      setSelectedPaneId(visible[0]?.paneId ?? null);
    }
  }, [visible, selectedPaneId]);

  async function openNewAgentPopup(): Promise<void> {
    const configuredBin = await getTmuxOption("@switchboard-bin");
    const switchboardBin = configuredBin || switchboardBinary();
    Bun.spawn([switchboardBin, "new-agent-popup", process.env["TMUX_PANE"] ?? ""], {
      stderr: "ignore",
      stdout: "ignore",
    });
  }

  useEffect(() => {
    let cancelled = false;
    void getTmuxOption("@switchboard-sidebar-density").then((value) => {
      const parsed = parseDensity(value);
      if (!cancelled && parsed) {
        setDensity(parsed);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useKeyboard((key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      renderer.destroy();
      process.exit(0);
      return;
    }

    if (key.name === "[" || key.name === "]") {
      setActiveTab((tab) => nextTab(tab, key.name === "[" ? -1 : 1, filterCwd !== null));
      return;
    }

    if (key.name === "n") {
      void openNewAgentPopup().catch((error) => {
        const message = error instanceof Error ? error.message : "failed to open launcher";
        setNotice(message);
      });
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
      if (selected) void attachAgent(selected).catch(() => {});
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
      <Header
        connection={connection}
        activeTab={activeTab}
        filterCwd={filterCwd}
      />
      <box style={{ flexDirection: "column", marginTop: 1, flexGrow: 1 }}>
        {visible.length === 0 ? (
          <text fg="#665c54">no agents{activeFilterCwd ? " in this cwd" : ""}</text>
        ) : activeTab === "all" ? (
          groups.map((group) => (
            <AgentGroupSection
              key={group.cwd}
              group={group}
              selectedPaneId={selectedPaneId}
              spacing={spacing}
            />
          ))
        ) : (
          visible.map((agent) => (
            <AgentRow
              key={agent.paneId}
              agent={agent}
              selected={agent.paneId === selectedPaneId}
              spacing={spacing.row}
            />
          ))
        )}
      </box>
      {notice ? <text fg="#928374">{truncate(notice, 80)}</text> : null}
      <text fg="#665c54">[/] tabs · j/k · enter attach · n new · q quit</text>
    </box>
  );
}

function AgentGroupSection({
  group,
  selectedPaneId,
  spacing,
}: {
  readonly group: AgentGroup;
  readonly selectedPaneId: string | null;
  readonly spacing: SidebarSpacing;
}) {
  return (
    <box style={{ flexDirection: "column", marginBottom: spacing.group }}>
      <text fg="#665c54">{truncate(group.cwd, 72)}</text>
      {group.agents.map((agent) => (
        <AgentRow
          key={agent.paneId}
          agent={agent}
          selected={agent.paneId === selectedPaneId}
          spacing={spacing.row}
        />
      ))}
    </box>
  );
}

function Header({
  connection,
  activeTab,
  filterCwd,
}: {
  readonly connection: ConnectionState;
  readonly activeTab: SidebarTab;
  readonly filterCwd: string | null;
}) {
  if (connection.kind === "connecting") {
    return <text fg="#928374">connecting…</text>;
  }
  if (connection.kind === "error") {
    return <text fg="#fb4934">error: {connection.message}</text>;
  }
  return (
    <box style={{ flexDirection: "column" }}>
      <box style={{ flexDirection: "row" }}>
        <TabLabel active={activeTab === "cwd"} label="cwd" disabled={!filterCwd} />
        <text fg="#504945"> </text>
        <TabLabel active={activeTab === "all"} label="all" disabled={false} />
      </box>
      {activeTab === "cwd" && filterCwd ? <text fg="#665c54">{truncate(filterCwd, 72)}</text> : null}
    </box>
  );
}

function TabLabel({
  active,
  disabled,
  label,
}: {
  readonly active: boolean;
  readonly disabled: boolean;
  readonly label: string;
}) {
  const fg = disabled ? "#504945" : active ? "#ebdbb2" : "#928374";
  const bg = active ? "#3c3836" : undefined;
  return <text fg={fg} bg={bg}>{` ${label} `}</text>;
}

function AgentRow({
  agent,
  selected,
  spacing = 1,
}: {
  readonly agent: AgentState;
  readonly selected: boolean;
  readonly spacing?: number;
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
        marginBottom: spacing,
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

function nextTab(current: SidebarTab, direction: -1 | 1, hasCwdTab: boolean): SidebarTab {
  const tabs = hasCwdTab ? SIDEBAR_TABS : SIDEBAR_TABS.filter((tab) => tab !== "cwd");
  const currentIndex = tabs.indexOf(current);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  return tabs[(safeIndex + direction + tabs.length) % tabs.length] ?? "all";
}

function groupAgentsByCwd(agents: readonly AgentState[]): readonly AgentGroup[] {
  const groups = new Map<string, AgentState[]>();
  for (const agent of agents) {
    const cwd = agent.cwd || "(unknown cwd)";
    const group = groups.get(cwd) ?? [];
    group.push(agent);
    groups.set(cwd, group);
  }

  return [...groups.entries()].map(([cwd, items]) => ({ cwd, agents: items }));
}

function parseDensity(value: string): SidebarDensity | null {
  if (value === "dense" || value === "normal" || value === "loose") return value;
  return null;
}

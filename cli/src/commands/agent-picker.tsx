import { type ScrollBoxRenderable } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { attachAgentSession } from "./attach.ts";
import { createAgentSession } from "./new.ts";
import { listInstalledAgentLaunchers, type AgentLauncher } from "../shared/agent-config.ts";
import { connect } from "../shared/client.ts";
import { ensureOpenTuiRuntime } from "../shared/opentui-runtime.ts";
import { createSwitchboardRenderer } from "../shared/opentui-renderer.ts";
import { paneWindow, viewerPaneForSessionInWindow } from "../shared/tmux-pane.ts";
import { tmux } from "../shared/tmux.ts";
import type { AgentState } from "../shared/state.ts";

type PickerTab = "cwd" | "all";

type AgentPickerOptions = {
  readonly cwd: string;
  readonly targetPane: string | null;
};

type PickerRow =
  | { readonly kind: "agent"; readonly agent: AgentState }
  | { readonly kind: "create"; readonly launcher: AgentLauncher };

type LoadState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly agents: readonly AgentState[];
      readonly launchers: readonly AgentLauncher[];
    }
  | { readonly kind: "error"; readonly message: string; readonly launchers: readonly AgentLauncher[] };

function parseOptions(args: readonly string[]): AgentPickerOptions {
  const cwdFlag = args.indexOf("--cwd");
  const targetPaneFlag = args.indexOf("--target-pane");
  return {
    cwd: cwdFlag >= 0 ? args[cwdFlag + 1] ?? process.cwd() : process.cwd(),
    targetPane: targetPaneFlag >= 0 ? args[targetPaneFlag + 1] ?? null : null,
  };
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

async function loadAgents(): Promise<readonly AgentState[]> {
  const client = await connect();
  const response = await client.request("state.list", {});
  client.close();

  if ("error" in response) {
    throw new Error(response.error.message);
  }

  const result = response.result as { agents?: readonly AgentState[] };
  return result.agents ?? [];
}

async function attachExistingAgent(agent: AgentState, options: AgentPickerOptions): Promise<void> {
  if (options.targetPane) {
    const windowId = await paneWindow(options.targetPane);
    const viewer = windowId ? await viewerPaneForSessionInWindow(windowId, agent.session) : "";
    if (viewer) {
      await tmux(["select-pane", "-t", viewer]);
      return;
    }
  }

  await attachAgentSession({
    target: agent.session,
    targetPane: options.targetPane ?? undefined,
  });
}

async function createAndAttachAgent(launcher: AgentLauncher, options: AgentPickerOptions): Promise<void> {
  const result = await createAgentSession({ tool: launcher.tool, cwd: options.cwd });
  if (!process.env["TMUX"]) return;

  await attachAgentSession({
    target: result.sessionName,
    targetPane: options.targetPane ?? undefined,
  });
}

function AgentPickerApp({ options }: { readonly options: AgentPickerOptions }) {
  const renderer = useRenderer();
  const terminal = useTerminalDimensions();
  const resultsRef = useRef<ScrollBoxRenderable | null>(null);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [tab, setTab] = useState<PickerTab>("cwd");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const launchers = await listInstalledAgentLaunchers();
      try {
        const agents = await loadAgents();
        if (!cancelled) {
          setState({ kind: "ready", agents, launchers });
        }
      } catch (error) {
        const text = error instanceof Error ? error.message : "failed to load agents";
        if (!cancelled) {
          setState({ kind: "error", message: text, launchers });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    const agents = state.kind === "ready" ? state.agents : [];
    const launchers = state.kind === "loading" ? [] : state.launchers;
    const visibleAgents = (tab === "cwd" ? agents.filter((agent) => agent.cwd === options.cwd) : agents)
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt);

    return [
      ...launchers.map((launcher): PickerRow => ({ kind: "create", launcher })),
      ...visibleAgents.map((agent): PickerRow => ({ kind: "agent", agent })),
    ];
  }, [state, options.cwd, tab]);
  const resultsHeight = Math.max(1, terminal.height - (message ? 7 : 6));

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  useEffect(() => {
    resultsRef.current?.scrollTo(0);
  }, [tab, options.cwd, rows.length]);

  useEffect(() => {
    const results = resultsRef.current;
    if (!results) return;

    const rowHeight = 3;
    const selectedTop = selectedIndex * rowHeight;
    const selectedBottom = selectedTop + rowHeight;
    const viewportTop = results.scrollTop;
    const viewportBottom = viewportTop + resultsHeight;

    if (selectedTop < viewportTop) {
      results.scrollTo(selectedTop);
      return;
    }

    if (selectedBottom > viewportBottom) {
      results.scrollTo(selectedBottom - resultsHeight);
    }
  }, [selectedIndex, resultsHeight]);

  function close(): void {
    renderer.destroy();
    process.exit(0);
  }

  async function choose(): Promise<void> {
    const row = rows[selectedIndex];
    if (!row) {
      close();
      return;
    }

    try {
      if (row.kind === "agent") {
        setMessage(`attaching ${row.agent.session}`);
        await attachExistingAgent(row.agent, options);
      } else {
        setMessage(`starting ${row.launcher.tool}`);
        await createAndAttachAgent(row.launcher, options);
      }
      close();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "agent action failed");
    }
  }

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) {
      close();
      return;
    }
    if (key.name === "[" || key.name === "]") {
      setTab((current) => (current === "cwd" ? "all" : "cwd"));
      setSelectedIndex(0);
      return;
    }
    if (rows.length === 0) return;
    if (key.name === "j" || key.name === "down") {
      setSelectedIndex((index) => Math.min(index + 1, rows.length - 1));
      return;
    }
    if (key.name === "k" || key.name === "up") {
      setSelectedIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (key.name === "return") {
      void choose();
    }
  });

  return (
    <box style={{ flexDirection: "column", padding: 1, flexGrow: 1, backgroundColor: "#1d2021" }}>
      <box style={{ flexDirection: "row", height: 1, flexShrink: 0 }}>
        <TabLabel active={tab === "cwd"} label="cwd" />
        <SingleLineText content=" " fg="#504945" width={1} />
        <TabLabel active={tab === "all"} label="all" />
      </box>
      <SingleLineText content={truncate(options.cwd, 72)} fg="#665c54" />
      <scrollbox
        ref={resultsRef}
        scrollY={true}
        scrollX={false}
        focusable={false}
        viewportCulling={true}
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
        style={{ flexDirection: "column", marginTop: 1, height: resultsHeight, flexShrink: 1 }}
      >
        {state.kind === "loading" ? <SingleLineText content="loading agents" fg="#928374" /> : null}
        {state.kind === "error" ? <SingleLineText content={state.message} fg="#fb4934" /> : null}
        {state.kind !== "loading" && rows.length === 0 ? (
          <SingleLineText content="no agents or integrations" fg="#928374" />
        ) : null}
        {rows.map((row, index) => (
          <PickerResultRow
            key={rowKey(row)}
            row={row}
            selected={index === selectedIndex}
          />
        ))}
      </scrollbox>
      {message ? <SingleLineText content={truncate(message, 72)} fg="#928374" /> : null}
      <SingleLineText content="[/] tabs · j/k select · enter attach/create · q close" fg="#665c54" />
    </box>
  );
}

function TabLabel({ active, label }: { readonly active: boolean; readonly label: string }) {
  return (
    <text
      content={` ${label} `}
      fg={active ? "#ebdbb2" : "#928374"}
      bg={active ? "#3c3836" : undefined}
      wrapMode="none"
      truncate={true}
      style={{ height: 1, width: label.length + 2, flexShrink: 0 }}
    />
  );
}

function PickerResultRow({
  row,
  selected,
}: {
  readonly row: PickerRow;
  readonly selected: boolean;
}) {
  const pointer = selected ? "▍" : " ";
  const pointerColor = selected ? "#fabd2f" : "#3c3836";
  const nameColor = selected ? "#ebdbb2" : "#a89984";

  if (row.kind === "agent") {
    return (
      <box style={{ flexDirection: "column", height: 3 }}>
        <box style={{ flexDirection: "row", height: 1 }}>
          <SingleLineText content={`${pointer} `} fg={pointerColor} width={2} />
          <SingleLineText content={`${row.agent.tool} `} fg={nameColor} width={12} />
          <SingleLineText content={row.agent.status} fg="#928374" />
        </box>
        <box style={{ flexDirection: "row", height: 1, paddingLeft: 3 }}>
          <SingleLineText content={truncate(`${row.agent.session} · ${row.agent.cwd}`, 68)} fg="#665c54" />
        </box>
      </box>
    );
  }

  return (
    <box style={{ flexDirection: "column", height: 3 }}>
      <box style={{ flexDirection: "row", height: 1 }}>
        <SingleLineText content={`${pointer} `} fg={pointerColor} width={2} />
        <SingleLineText content="new " fg="#8ec07c" width={4} />
        <SingleLineText content={row.launcher.tool} fg={nameColor} />
      </box>
      <box style={{ flexDirection: "row", height: 1, paddingLeft: 3 }}>
        <SingleLineText
          content={truncate(row.launcher.displayCommand, 68)}
          fg={row.launcher.configured ? "#8ec07c" : "#665c54"}
        />
      </box>
    </box>
  );
}

function SingleLineText({
  content,
  fg,
  width,
}: {
  readonly content: string;
  readonly fg: string;
  readonly width?: number;
}) {
  return (
    <text
      content={content}
      fg={fg}
      wrapMode="none"
      truncate={true}
      style={{ height: 1, width, flexShrink: width ? 0 : 1 }}
    />
  );
}

function rowKey(row: PickerRow): string {
  if (row.kind === "agent") return `agent:${row.agent.session}`;
  return `create:${row.launcher.tool}`;
}

export async function runAgentPicker(args: readonly string[]): Promise<void> {
  await ensureOpenTuiRuntime();
  const renderer = await createSwitchboardRenderer();
  createRoot(renderer).render(<AgentPickerApp options={parseOptions(args)} />);
}

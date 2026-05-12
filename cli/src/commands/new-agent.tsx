import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";
import { useEffect, useState } from "react";
import { attachAgentSession } from "./attach.ts";
import { createAgentSession } from "./new.ts";
import { listInstalledAgentLaunchers, type AgentLauncher } from "../shared/agent-config.ts";

type NewAgentOptions = {
  readonly cwd: string;
  readonly targetPane: string | null;
};

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly launchers: readonly AgentLauncher[] }
  | { readonly kind: "error"; readonly message: string };

function parseOptions(args: readonly string[]): NewAgentOptions {
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

async function spawnAgent(launcher: AgentLauncher, options: NewAgentOptions): Promise<void> {
  const result = await createAgentSession({ tool: launcher.tool, cwd: options.cwd });
  if (process.env["TMUX"]) {
    await attachAgentSession({
      target: result.sessionName,
      targetPane: options.targetPane ?? undefined,
    });
  }
}

function NewAgentApp({ options }: { readonly options: NewAgentOptions }) {
  const renderer = useRenderer();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const launchers = state.kind === "ready" ? state.launchers : [];

  useEffect(() => {
    let cancelled = false;
    void listInstalledAgentLaunchers()
      .then((items) => {
        if (!cancelled) setState({ kind: "ready", launchers: items });
      })
      .catch((error) => {
        const text = error instanceof Error ? error.message : "failed to load integrations";
        if (!cancelled) setState({ kind: "error", message: text });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function close(): void {
    renderer.destroy();
    process.exit(0);
  }

  async function choose(): Promise<void> {
    const launcher = launchers[selectedIndex];
    if (!launcher) {
      close();
      return;
    }
    setMessage(`starting ${launcher.tool}`);
    try {
      await spawnAgent(launcher, options);
      close();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "failed to start agent");
    }
  }

  useKeyboard((key) => {
    if (key.name === "escape" || key.name === "q" || (key.ctrl && key.name === "c")) {
      close();
      return;
    }
    if (state.kind !== "ready") return;
    if (key.name === "j" || key.name === "down") {
      setSelectedIndex((index) => Math.min(index + 1, Math.max(launchers.length - 1, 0)));
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
      <text fg="#fabd2f">new agent</text>
      <text fg="#665c54">{truncate(options.cwd, 72)}</text>
      <box style={{ flexDirection: "column", marginTop: 1, flexGrow: 1 }}>
        {state.kind === "loading" ? <text fg="#928374">loading integrations</text> : null}
        {state.kind === "error" ? <text fg="#fb4934">{state.message}</text> : null}
        {state.kind === "ready" && launchers.length === 0 ? (
          <text fg="#928374">no installed integrations</text>
        ) : null}
        {launchers.map((launcher, index) => (
          <LauncherRow
            key={launcher.tool}
            launcher={launcher}
            selected={index === selectedIndex}
          />
        ))}
      </box>
      {message ? <text fg="#928374">{truncate(message, 72)}</text> : null}
      <text fg="#665c54">j/k select · enter spawn · q close</text>
    </box>
  );
}

function LauncherRow({
  launcher,
  selected,
}: {
  readonly launcher: AgentLauncher;
  readonly selected: boolean;
}) {
  const pointer = selected ? "▍" : " ";
  const nameColor = selected ? "#ebdbb2" : "#a89984";
  const commandColor = launcher.configured ? "#8ec07c" : "#665c54";
  return (
    <box style={{ flexDirection: "column", marginBottom: 1 }}>
      <box style={{ flexDirection: "row" }}>
        <text fg={selected ? "#fabd2f" : "#3c3836"}>{pointer} </text>
        <text fg={nameColor}>{launcher.tool}</text>
      </box>
      <box style={{ flexDirection: "row", paddingLeft: 3 }}>
        <text fg={commandColor}>{truncate(launcher.displayCommand, 68)}</text>
      </box>
    </box>
  );
}

export async function runNewAgent(args: readonly string[]): Promise<void> {
  const renderer = await createCliRenderer();
  createRoot(renderer).render(<NewAgentApp options={parseOptions(args)} />);
}

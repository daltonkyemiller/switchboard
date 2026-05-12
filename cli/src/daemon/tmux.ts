import { agentTmux, tmux } from "../shared/tmux.ts";
import { paths } from "../shared/paths.ts";
import type { TmuxServer } from "../shared/state.ts";

type PaneInfo = {
  readonly paneId: string;
  readonly panePid: number;
  readonly session: string;
  readonly windowIndex: number;
  readonly windowName: string;
  readonly cwd: string;
};

async function listPanesFor(server: TmuxServer): Promise<readonly PaneInfo[] | null> {
  const format = [
    "#{pane_id}",
    "#{pane_pid}",
    "#{session_name}",
    "#{window_index}",
    "#{window_name}",
    "#{pane_current_path}",
  ].join("\t");

  const result =
    server === "agent"
      ? await agentTmux(["list-panes", "-aF", format])
      : await tmux(["list-panes", "-aF", format]);
  if (!result.ok) return null;

  const text = result.stdout;
  const lines = text.split("\n").filter(Boolean);

  return lines.flatMap((line) => {
    const parts = line.split("\t");
    if (parts.length < 6) return [];
    const [paneId, panePid, session, windowIndex, windowName, cwd] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const pid = Number.parseInt(panePid, 10);
    const idx = Number.parseInt(windowIndex, 10);
    if (Number.isNaN(pid) || Number.isNaN(idx)) return [];
    return [{ paneId, panePid: pid, session, windowIndex: idx, windowName, cwd }];
  });
}

export async function listPanes(): Promise<readonly PaneInfo[] | null> {
  const agentPanes = await listPanesFor("agent");
  const outerPanes = await listPanesFor("outer");
  if (agentPanes === null && outerPanes === null) return null;
  return [...(agentPanes ?? []), ...(outerPanes ?? [])];
}

export async function listOuterPanes(): Promise<readonly PaneInfo[] | null> {
  return listPanesFor("outer");
}

export async function isAgentTmuxServerAlive(): Promise<boolean> {
  const result = await tmux(["-S", paths.agentTmuxSocket, "display-message", "-p", "switchboard"]);
  return result.ok;
}

export async function paneInfo(
  paneId: string,
  preferredServer: TmuxServer = "agent",
): Promise<PaneInfo | null> {
  const first = await listPanesFor(preferredServer);
  const firstMatch = first?.find((p) => p.paneId === paneId);
  if (firstMatch) return firstMatch;

  const secondServer = preferredServer === "agent" ? "outer" : "agent";
  const second = await listPanesFor(secondServer);
  return second?.find((p) => p.paneId === paneId) ?? null;
}

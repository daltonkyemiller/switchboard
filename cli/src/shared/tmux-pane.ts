import { paths } from "./paths.ts";
import { agentTmux, tmux, tmuxOption } from "./tmux.ts";

type TmuxPane = {
  readonly paneId: string;
  readonly paneWidth: number;
  readonly role: string;
};

type PaneProcess = {
  readonly pid: number;
  readonly command: string;
};

const AGENT_COMMANDS = new Set(["claude", "codex", "opencode"]);

export async function paneValue(pane: string, format: string): Promise<string> {
  const result = await tmux(["display-message", "-t", pane, "-p", format]);
  return result.ok ? result.stdout : "";
}

export async function paneRole(pane: string): Promise<string> {
  return paneValue(pane, "#{@switchboard_role}");
}

export async function paneWindow(pane: string): Promise<string> {
  return paneValue(pane, "#{window_id}");
}

export async function paneCwd(pane: string): Promise<string> {
  return paneValue(pane, "#{pane_current_path}");
}

export async function panePid(pane: string): Promise<number | null> {
  const raw = await paneValue(pane, "#{pane_pid}");
  const pid = Number.parseInt(raw, 10);
  return Number.isNaN(pid) ? null : pid;
}

export async function sessionRole(session: string): Promise<string> {
  const result = await tmux(["show-options", "-t", session, "-qv", "@switchboard_role"]);
  return result.ok ? result.stdout : "";
}

export async function resolveCallerPane(bindingPane: string | null): Promise<string> {
  const raw = bindingPane || process.env["TMUX_PANE"] || "";
  if (!raw) return "";

  const session = await paneValue(raw, "#{session_name}");
  if (!session) return raw;

  const role = await sessionRole(session);
  if (role !== "agent") return raw;

  const owner = await viewerPaneForSession(session);
  return owner || raw;
}

export async function viewerPaneForSession(session: string): Promise<string> {
  const result = await tmux([
    "list-panes",
    "-a",
    "-F",
    "#{pane_id}\t#{@switchboard_target_session}",
  ]);
  if (!result.ok) return "";
  return (
    result.stdout
      .split("\n")
      .map((line) => line.split("\t"))
      .find(([, target]) => target === session)?.[0] ?? ""
  );
}

async function windowPanes(windowId: string): Promise<readonly TmuxPane[]> {
  const result = await tmux([
    "list-panes",
    "-t",
    windowId,
    "-F",
    "#{pane_id}\t#{pane_width}\t#{@switchboard_role}",
  ]);
  if (!result.ok) return [];

  return result.stdout.split("\n").flatMap((line) => {
    const [paneId, paneWidth, role = ""] = line.split("\t");
    if (!paneId || !paneWidth) return [];
    const width = Number.parseInt(paneWidth, 10);
    if (Number.isNaN(width)) return [];
    return [{ paneId, paneWidth: width, role }];
  });
}

export async function findSidebar(windowId: string): Promise<string> {
  const panes = await windowPanes(windowId);
  return panes.find((pane) => pane.role === "sidebar")?.paneId ?? "";
}

export async function largestWorkingPane(windowId: string): Promise<string> {
  const panes = await windowPanes(windowId);
  return (
    panes
      .filter((pane) => pane.role !== "sidebar")
      .sort((a, b) => b.paneWidth - a.paneWidth)[0]?.paneId ?? ""
  );
}

export async function workingPaneCount(windowId: string): Promise<number> {
  const panes = await windowPanes(windowId);
  return panes.filter((pane) => pane.role !== "sidebar").length;
}

export async function targetForAction(callerPane: string): Promise<string> {
  const windowId = await paneWindow(callerPane);
  if (!windowId) return callerPane;

  const sidebar = await findSidebar(windowId);
  if (sidebar && callerPane === sidebar) {
    return largestWorkingPane(windowId);
  }

  return callerPane;
}

export async function popupClientForPane(pane: string): Promise<string> {
  if (!pane) return "";
  const result = await tmux(["list-clients", "-F", "#{client_name}\t#{pane_id}"]);
  if (!result.ok) return "";
  return (
    result.stdout
      .split("\n")
      .map((line) => line.split("\t"))
      .find(([, paneId]) => paneId === pane)?.[0] ?? ""
  );
}

async function childProcesses(pid: number): Promise<readonly PaneProcess[]> {
  const result = await Bun.spawn(["pgrep", "-P", String(pid)], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const text = await new Response(result.stdout).text();
  await result.exited;

  const pids = text
    .split("\n")
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((value) => !Number.isNaN(value));

  return Promise.all(
    pids.map(async (childPid) => {
      const proc = Bun.spawn(["ps", "-o", "comm=", "-p", String(childPid)], {
        stdout: "pipe",
        stderr: "ignore",
      });
      const command = (await new Response(proc.stdout).text()).trim();
      await proc.exited;
      return { pid: childPid, command };
    }),
  );
}

async function hasAgentDescendant(pid: number, depth = 0): Promise<boolean> {
  if (depth > 2) return false;
  const children = await childProcesses(pid);
  for (const child of children) {
    if (AGENT_COMMANDS.has(child.command)) return true;
    if (await hasAgentDescendant(child.pid, depth + 1)) return true;
  }
  return false;
}

export async function isAgentPane(pane: string): Promise<boolean> {
  const role = await paneRole(pane);
  if (role === "viewer") return true;

  const session = await paneValue(pane, "#{session_name}");
  if (session && (await sessionRole(session)) === "agent") return true;

  const pid = await panePid(pane);
  return pid !== null ? hasAgentDescendant(pid) : false;
}

export async function agentCwdForViewer(pane: string): Promise<string> {
  const session = await paneValue(pane, "#{@switchboard_target_session}");
  if (!session) return "";
  const result = await agentTmux(["list-panes", "-t", session, "-F", "#{pane_current_path}"]);
  if (!result.ok) return "";
  return result.stdout.split("\n")[0] ?? "";
}

export async function sidebarWidth(): Promise<number> {
  const width = Number.parseInt(await tmuxOption("@switchboard-sidebar-width"), 10);
  return Number.isNaN(width) ? 32 : width;
}

export { paths };

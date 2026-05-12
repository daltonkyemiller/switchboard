import {
  findSidebar,
  largestWorkingPane,
  paneWindow,
  resolveCallerPane,
  sidebarWidth,
  targetForAction,
  workingPaneCount,
} from "../shared/tmux-pane.ts";
import { tmux } from "../shared/tmux.ts";

type RouterAction = "split-h" | "split-v" | "next-layout" | "swap-prev" | "swap-next";

const LAYOUTS = ["even-horizontal", "even-vertical", "main-horizontal", "main-vertical", "tiled"] as const;

function isRouterAction(value: string): value is RouterAction {
  return value === "split-h" || value === "split-v" || value === "next-layout" || value === "swap-prev" || value === "swap-next";
}

async function message(text: string): Promise<void> {
  await tmux(["display-message", text]);
}

async function targetOrMessage(callerPane: string): Promise<string> {
  const target = await targetForAction(callerPane);
  if (target) return target;
  await message("switchboard: no working pane to act on");
  return "";
}

async function runSplit(action: "split-h" | "split-v", callerPane: string): Promise<void> {
  const target = await targetOrMessage(callerPane);
  if (!target) return;
  await tmux(["split-window", "-t", target, action === "split-h" ? "-h" : "-v"]);
}

async function runSwap(direction: "U" | "D", callerPane: string): Promise<void> {
  const target = await targetOrMessage(callerPane);
  if (!target) return;

  const windowId = await paneWindow(callerPane);
  const sidebar = windowId ? await findSidebar(windowId) : "";
  if (!sidebar) {
    await tmux(["swap-pane", `-${direction}`, "-t", target]);
    return;
  }

  if ((await workingPaneCount(windowId)) < 2) return;
  const width = String(await sidebarWidth());
  const result = await tmux([
    "break-pane",
    "-d",
    "-s",
    sidebar,
    ";",
    "swap-pane",
    `-${direction}`,
    "-t",
    target,
    ";",
    "join-pane",
    "-fhb",
    "-l",
    width,
    "-s",
    sidebar,
    "-t",
    target,
    ";",
    "select-pane",
    "-t",
    target,
  ]);
  if (!result.ok) {
    await message("switchboard: pane swap failed");
  }
}

async function runNextLayout(callerPane: string): Promise<void> {
  const windowId = await paneWindow(callerPane);
  if (!windowId) return;

  const currentResult = await tmux(["show-options", "-t", windowId, "-wqv", "@switchboard-layout-cycle"]);
  const rawCurrent = currentResult.ok ? currentResult.stdout : "";
  const current = Number.parseInt(rawCurrent, 10);
  const nextIndex = (Number.isNaN(current) ? 0 : current + 1) % LAYOUTS.length;
  const layout = LAYOUTS[nextIndex] ?? "tiled";

  const sidebar = await findSidebar(windowId);
  if (!sidebar) {
    await tmux(["select-layout", "-t", windowId, layout]);
    await tmux(["set-option", "-t", windowId, "-w", "-q", "@switchboard-layout-cycle", String(nextIndex)]);
    return;
  }

  let active = callerPane;
  if (active === sidebar) {
    active = await largestWorkingPane(windowId);
    if (!active) {
      await message("switchboard: no working pane to act on");
      return;
    }
  }

  const width = String(await sidebarWidth());
  const result = await tmux([
    "break-pane",
    "-d",
    "-s",
    sidebar,
    ";",
    "select-layout",
    "-t",
    windowId,
    layout,
    ";",
    "join-pane",
    "-fhb",
    "-l",
    width,
    "-s",
    sidebar,
    "-t",
    active,
    ";",
    "select-pane",
    "-t",
    active,
  ]);
  if (!result.ok) {
    await message("switchboard: layout cycle failed");
    return;
  }

  await tmux(["set-option", "-t", windowId, "-w", "-q", "@switchboard-layout-cycle", String(nextIndex)]);
  await message(`switchboard: ${layout} @ ${windowId}`);
}

export async function runRouter(args: readonly string[]): Promise<void> {
  const [action, bindingPane] = args;
  if (!action || !isRouterAction(action)) {
    console.error("usage: switchboard router <split-h|split-v|next-layout|swap-prev|swap-next> [pane]");
    process.exit(1);
  }

  const callerPane = await resolveCallerPane(bindingPane ?? null);
  if (!callerPane) {
    await message("switchboard: no caller pane");
    return;
  }

  switch (action) {
    case "split-h":
    case "split-v":
      await runSplit(action, callerPane);
      return;
    case "swap-prev":
      await runSwap("U", callerPane);
      return;
    case "swap-next":
      await runSwap("D", callerPane);
      return;
    case "next-layout":
      await runNextLayout(callerPane);
      return;
  }
}

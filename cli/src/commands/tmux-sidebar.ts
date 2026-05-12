import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { findSidebar } from "../shared/tmux-pane.ts";
import { switchboardCommand, tmux, tmuxOption } from "../shared/tmux.ts";

const ENFORCE_THROTTLE_MS = 200;
const SAVED_LAYOUT_OPTION = "@switchboard_layout_without_sidebar";

function currentTimeMs(): number {
  return Date.now();
}

function stampFile(): string {
  return join(process.env["TMPDIR"] ?? "/tmp", `switchboard-enforce-${process.getuid?.() ?? "user"}.stamp`);
}

async function numericOption(name: string, fallback: number): Promise<number> {
  const value = Number.parseInt(await tmuxOption(name), 10);
  return Number.isNaN(value) ? fallback : value;
}

async function windowOption(windowId: string, name: string): Promise<string> {
  const result = await tmux(["show-options", "-t", windowId, "-wqv", name]);
  return result.ok ? result.stdout : "";
}

async function windowLayout(windowId: string): Promise<string> {
  const result = await tmux(["display-message", "-t", windowId, "-p", "#{window_layout}"]);
  return result.ok ? result.stdout : "";
}

async function restoreSavedLayout(windowId: string): Promise<void> {
  const layout = await windowOption(windowId, SAVED_LAYOUT_OPTION);
  if (!layout) return;

  await tmux(["select-layout", "-t", windowId, layout]);
}

export async function runSidebarToggle(args: readonly string[]): Promise<void> {
  const bindingPane = args[0] ?? process.env["TMUX_PANE"] ?? "";
  const currentWindowResult = bindingPane
    ? await tmux(["display-message", "-t", bindingPane, "-p", "#{window_id}"])
    : await tmux(["display-message", "-p", "#{window_id}"]);
  const currentWindow = currentWindowResult.ok ? currentWindowResult.stdout : "";
  const existing = currentWindow ? await findSidebar(currentWindow) : "";
  if (existing) {
    await tmux(["kill-pane", "-t", existing]);
    await restoreSavedLayout(currentWindow);
    return;
  }

  const layout = currentWindow ? await windowLayout(currentWindow) : "";
  if (currentWindow && layout) {
    await tmux(["set-option", "-t", currentWindow, "-w", "-q", SAVED_LAYOUT_OPTION, layout]);
  }

  const width = String(await numericOption("@switchboard-sidebar-width", 32));
  const command = (await tmuxOption("@switchboard-command")) || `${switchboardCommand()} sidebar`;
  const created = await tmux([
    "split-window",
    "-fhb",
    "-l",
    width,
    "-P",
    "-F",
    "#{pane_id}",
    "-e",
    "OPENTUI_GRAPHICS=false",
    command,
  ]);
  if (!created.ok || !created.stdout) return;
  await tmux(["set-option", "-p", "-t", created.stdout, "-q", "@switchboard_role", "sidebar"]);
}

export async function runSidebarEnforceWidth(): Promise<void> {
  const file = stampFile();
  const now = currentTimeMs();
  const previous = Number.parseInt(await readFile(file, "utf8").catch(() => "0"), 10);
  if (!Number.isNaN(previous) && now - previous < ENFORCE_THROTTLE_MS) return;
  await writeFile(file, String(now)).catch(() => {});

  const minWidth = await numericOption("@switchboard-sidebar-width", 32);
  const maxWidth = await numericOption("@switchboard-sidebar-max-width", 0);
  if (minWidth === 0 && maxWidth === 0) return;

  const panes = await tmux([
    "list-panes",
    "-a",
    "-F",
    "#{pane_id}\t#{pane_width}\t#{window_panes}\t#{@switchboard_role}",
  ]);
  if (!panes.ok) return;

  for (const line of panes.stdout.split("\n")) {
    const [paneId, paneWidth, windowPanes, role] = line.split("\t");
    if (!paneId || role !== "sidebar") continue;
    const width = Number.parseInt(paneWidth ?? "", 10);
    const count = Number.parseInt(windowPanes ?? "", 10);
    if (Number.isNaN(width) || Number.isNaN(count) || count < 2) continue;

    let target = 0;
    if (minWidth > 0 && width < minWidth) target = minWidth;
    if (maxWidth > 0 && width > maxWidth) target = maxWidth;
    if (target > 0 && target !== width) {
      await tmux(["resize-pane", "-t", paneId, "-x", String(target)]);
    }
  }
}

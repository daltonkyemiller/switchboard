import {
  agentCwdForViewer,
  isAgentPane,
  largestWorkingPane,
  paneCwd,
  paneRole,
  paneWindow,
  popupClientForPane,
} from "../shared/tmux-pane.ts";
import { shellQuote, switchboardCommand, tmux } from "../shared/tmux.ts";

async function targetPaneForSpawn(bindingPane: string): Promise<string> {
  if ((await paneRole(bindingPane)) !== "sidebar") return bindingPane;
  const windowId = await paneWindow(bindingPane);
  return windowId ? largestWorkingPane(windowId) : "";
}

async function cwdForTargetPane(targetPane: string): Promise<string> {
  const agentCwd = await agentCwdForViewer(targetPane);
  if (agentCwd) return agentCwd;
  return (await paneCwd(targetPane)) || process.cwd();
}

export async function runNewAgentPopup(args: readonly string[]): Promise<void> {
  const bindingPane = args[0] ?? process.env["TMUX_PANE"] ?? "";
  if (!bindingPane) {
    await tmux(["display-message", "switchboard new: no caller pane"]);
    return;
  }

  const targetPane = await targetPaneForSpawn(bindingPane);
  if (!targetPane) {
    await tmux(["display-message", "switchboard new: no working pane to attach beside"]);
    return;
  }

  const cwd = await cwdForTargetPane(targetPane);
  const popupClient = await popupClientForPane(targetPane);
  await tmux([
    "display-popup",
    ...(popupClient ? ["-c", popupClient] : []),
    "-E",
    "-w",
    "58",
    "-h",
    "14",
    "-d",
    cwd,
    "-b",
    "rounded",
    "-T",
    " switchboard new agent ",
    `${switchboardCommand()} new-agent --target-pane ${shellQuote(targetPane)} --cwd ${shellQuote(cwd)}`,
  ]);
}

export async function runPickPopup(args: readonly string[]): Promise<void> {
  const bindingPane = args[0] ?? process.env["TMUX_PANE"] ?? "";
  if (!bindingPane) {
    await tmux(["display-message", "switchboard pick: no caller pane"]);
    return;
  }

  if (!(await isAgentPane(bindingPane))) return;

  const cwd = (await paneCwd(bindingPane)) || process.cwd();
  const popupClient = await popupClientForPane(bindingPane);
  await tmux([
    "display-popup",
    ...(popupClient ? ["-c", popupClient] : []),
    "-E",
    "-w",
    "90%",
    "-h",
    "80%",
    "-d",
    cwd,
    "-b",
    "rounded",
    "-T",
    " switchboard pick ",
    `${switchboardCommand()} pick --target ${shellQuote(bindingPane)} --cwd ${shellQuote(cwd)}`,
  ]);
}

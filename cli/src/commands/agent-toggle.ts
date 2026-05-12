import { attachAgentSession } from "./attach.ts";
import { lastAgentForCwd } from "../shared/last-agent.ts";
import {
  cwdForTargetPane,
  paneWindow,
  popupClientForPane,
  targetPaneForSpawn,
  viewerPaneForSessionInWindow,
} from "../shared/tmux-pane.ts";
import { agentTmux, popupShellCommand, shellQuote, switchboardCommand, tmux } from "../shared/tmux.ts";

async function sessionExists(session: string): Promise<boolean> {
  const result = await agentTmux(["has-session", "-t", session]);
  return result.ok;
}

async function openAgentPicker(targetPane: string, cwd: string): Promise<void> {
  const popupClient = await popupClientForPane(targetPane);
  await tmux([
    "display-popup",
    ...(popupClient ? ["-c", popupClient] : []),
    "-E",
    "-w",
    "72",
    "-h",
    "20",
    "-d",
    cwd,
    "-b",
    "rounded",
    "-T",
    " switchboard agent ",
    popupShellCommand(
      `${switchboardCommand()} agent-picker --target-pane ${shellQuote(targetPane)} --cwd ${shellQuote(cwd)}`,
      "switchboard agent popup",
    ),
  ]);
}

export async function runAgentToggle(args: readonly string[]): Promise<void> {
  const bindingPane = args[0] ?? process.env["TMUX_PANE"] ?? "";
  if (!bindingPane) {
    await tmux(["display-message", "switchboard agent: no caller pane"]);
    return;
  }

  const targetPane = await targetPaneForSpawn(bindingPane);
  if (!targetPane) {
    await tmux(["display-message", "switchboard agent: no working pane to attach beside"]);
    return;
  }

  const cwd = await cwdForTargetPane(targetPane);
  const session = await lastAgentForCwd(cwd);
  if (!session || !(await sessionExists(session))) {
    await openAgentPicker(targetPane, cwd);
    return;
  }

  const windowId = await paneWindow(targetPane);
  const viewer = windowId ? await viewerPaneForSessionInWindow(windowId, session) : "";
  if (viewer) {
    await tmux(["kill-pane", "-t", viewer]);
    return;
  }

  await attachAgentSession({ target: session, targetPane });
}

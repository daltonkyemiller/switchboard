import {
  cwdForTargetPane,
  isAgentPane,
  paneCwd,
  popupClientForPane,
  targetPaneForSpawn,
} from "../shared/tmux-pane.ts";
import { popupShellCommand, shellQuote, switchboardCommand, tmux } from "../shared/tmux.ts";

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
    popupShellCommand(
      `${switchboardCommand()} new-agent --target-pane ${shellQuote(targetPane)} --cwd ${shellQuote(cwd)}`,
      "switchboard new agent popup",
    ),
  ]);
}

export async function runAgentPickerPopup(args: readonly string[]): Promise<void> {
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

export async function runPickPopup(args: readonly string[]): Promise<void> {
  const bindingPane = args[0] ?? process.env["TMUX_PANE"] ?? "";
  const passThroughKey = args[1] ?? "";
  if (!bindingPane) {
    await tmux(["display-message", "switchboard pick: no caller pane"]);
    return;
  }

  if (!(await isAgentPane(bindingPane))) {
    if (passThroughKey.length === 1) {
      await tmux(["send-keys", "-t", bindingPane, "-l", passThroughKey]);
    }
    return;
  }

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
    popupShellCommand(
      `${switchboardCommand()} pick --target ${shellQuote(bindingPane)} --cwd ${shellQuote(cwd)}`,
      "switchboard pick popup",
    ),
  ]);
}

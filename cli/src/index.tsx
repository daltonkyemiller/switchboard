import { runAttach } from "./commands/attach.ts";
import { runDaemon } from "./commands/daemon.ts";
import { runGrammar } from "./commands/grammar.ts";
import { runIntegration } from "./commands/integration.ts";
import { runList } from "./commands/list.ts";
import { runNewAgent } from "./commands/new-agent.tsx";
import { runNew } from "./commands/new.ts";
import { runPick, runPickAgent } from "./commands/pick.tsx";
import { runRelease, runReport } from "./commands/report.ts";
import { runSidebar } from "./commands/sidebar.tsx";
import { runNewAgentPopup, runPickPopup } from "./commands/tmux-popup.ts";
import { runRouter } from "./commands/tmux-router.ts";
import { runSidebarEnforceWidth, runSidebarToggle } from "./commands/tmux-sidebar.ts";
import { runWatch } from "./commands/watch.ts";

function printUsage(): void {
  console.error(`switchboard — tmux-native agent multiplexer

usage:
  switchboard daemon                                run the background server
  switchboard sidebar [--cwd PATH | --all]          tui sidebar (default: cwd of this pane)
  switchboard new <tool> [--detach] [args...]       spawn agent in a detached tmux session
  switchboard new-agent [--cwd PATH]                picker for spawning installed agents
  switchboard new-agent-popup [pane]                tmux popup wrapper for new-agent
  switchboard attach <session>                      open a viewer pane that attaches to an agent
  switchboard pick [--target PANE] [--cwd PATH]     file/content picker; inserts @path into target
  switchboard pick-popup [pane]                     tmux popup wrapper for pick
  switchboard pick-agent --session SESSION          internal: open picker from agent tmux server
  switchboard sidebar-toggle [pane]                 toggle sidebar in the current window
  switchboard sidebar-enforce-width                 clamp sidebar width from tmux hooks
  switchboard router <action> [pane]                routed tmux split/layout/swap actions
  switchboard grammar list|add                      manage picker Tree-sitter grammars
  switchboard list [--cwd PATH]                     list tracked agents
  switchboard watch                                 stream agent events
  switchboard integration install <claude|codex|opencode>   install agent hook
  switchboard report <tool> <status>                debug: report state for $TMUX_PANE
  switchboard release                               debug: release $TMUX_PANE`);
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case "daemon":
      await runDaemon();
      return;
    case "list": {
      const cwdFlag = rest.indexOf("--cwd");
      const cwd = cwdFlag >= 0 ? rest[cwdFlag + 1] ?? null : null;
      await runList(cwd);
      return;
    }
    case "watch":
      await runWatch();
      return;
    case "sidebar":
      await runSidebar(rest);
      return;
    case "integration":
      await runIntegration(rest);
      return;
    case "grammar":
      await runGrammar(rest);
      return;
    case "new":
      await runNew(rest);
      return;
    case "new-agent":
      await runNewAgent(rest);
      return;
    case "new-agent-popup":
      await runNewAgentPopup(rest);
      return;
    case "attach":
      await runAttach(rest);
      return;
    case "pick":
      await runPick(rest);
      return;
    case "pick-popup":
      await runPickPopup(rest);
      return;
    case "pick-agent":
      await runPickAgent(rest);
      return;
    case "sidebar-toggle":
      await runSidebarToggle(rest);
      return;
    case "sidebar-enforce-width":
      await runSidebarEnforceWidth();
      return;
    case "router":
      await runRouter(rest);
      return;
    case "report":
      await runReport(rest);
      return;
    case "release":
      await runRelease();
      return;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      printUsage();
      return;
    default:
      console.error(`unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

await main();

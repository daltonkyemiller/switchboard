import { snapshot, remove } from "./store.ts";
import { isAgentTmuxServerAlive, listOuterPanes, listPanes } from "./tmux.ts";

const PROCESS_TICK_MS = 1_000;
const TMUX_TICK_MS = 3_000;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

function sweepProcesses(): void {
  for (const state of snapshot()) {
    if (state.pid === null) continue;
    if (!isAlive(state.pid)) {
      remove(state.paneId);
    }
  }
}

async function sweepPanes(): Promise<void> {
  const isAgentServerAlive = await isAgentTmuxServerAlive();
  if (!isAgentServerAlive) {
    for (const state of snapshot()) {
      if (state.tmuxServer === "agent") {
        remove(state.paneId);
      }
    }
    const outerPanes = await listOuterPanes();
    if (outerPanes === null) return;
    sweepMissingPanes(outerPanes);
    return;
  }

  const panes = await listPanes();
  if (panes === null) return;
  sweepMissingPanes(panes);
}

function sweepMissingPanes(panes: readonly { readonly paneId: string }[]): void {
  const live = new Set(panes.map((p) => p.paneId));
  for (const state of snapshot()) {
    if (!live.has(state.paneId)) {
      remove(state.paneId);
    }
  }
}

export function startReaper(): () => void {
  const processTimer = setInterval(sweepProcesses, PROCESS_TICK_MS);
  const tmuxTimer = setInterval(() => {
    void sweepPanes();
  }, TMUX_TICK_MS);
  return () => {
    clearInterval(processTimer);
    clearInterval(tmuxTimer);
  };
}

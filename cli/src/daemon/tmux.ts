type PaneInfo = {
  readonly paneId: string;
  readonly panePid: number;
  readonly session: string;
  readonly windowIndex: number;
  readonly windowName: string;
  readonly cwd: string;
};

export async function listPanes(): Promise<readonly PaneInfo[] | null> {
  const format = [
    "#{pane_id}",
    "#{pane_pid}",
    "#{session_name}",
    "#{window_index}",
    "#{window_name}",
    "#{pane_current_path}",
  ].join("\t");

  const proc = Bun.spawn(["tmux", "list-panes", "-aF", format], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) return null;

  const text = await new Response(proc.stdout).text();
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

export async function paneInfo(paneId: string): Promise<PaneInfo | null> {
  const all = await listPanes();
  if (!all) return null;
  return all.find((p) => p.paneId === paneId) ?? null;
}

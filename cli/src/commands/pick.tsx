import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { PickerApp } from "../picker/app.tsx";
import { loadPickerTheme } from "../picker/theme.ts";
import { tmux } from "../shared/tmux.ts";

const SAFE_ARG = /^[a-zA-Z0-9_\/=:.@%+,-]+$/;

function shellQuote(value: string): string {
  if (SAFE_ARG.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function valueForFlag(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? null : null;
}

export async function runPick(args: readonly string[]): Promise<void> {
  const targetIndex = args.indexOf("--target");
  const target = targetIndex >= 0 ? args[targetIndex + 1] ?? null : null;
  const cwdIndex = args.indexOf("--cwd");
  const cwd = cwdIndex >= 0 ? args[cwdIndex + 1] ?? process.cwd() : process.cwd();
  const queryIndex = args.indexOf("--query");
  const initialQuery = queryIndex >= 0 ? args[queryIndex + 1] ?? "" : "";

  const theme = await loadPickerTheme();
  const renderer = await createCliRenderer();
  createRoot(renderer).render(
    <PickerApp cwd={cwd} targetPane={target} initialQuery={initialQuery} theme={theme} />,
  );
}

export async function runPickAgent(args: readonly string[]): Promise<void> {
  const session = valueForFlag(args, "--session");
  const cwd = valueForFlag(args, "--cwd") ?? process.cwd();
  if (!session) {
    console.error("usage: switchboard pick-agent --session SESSION [--cwd PATH]");
    process.exit(1);
  }

  const panes = await tmux([
    "list-panes",
    "-a",
    "-F",
    "#{pane_id}\t#{@switchboard_target_session}",
  ]);
  if (!panes.ok) return;

  const viewerPane = panes.stdout
    .split("\n")
    .map((line) => line.split("\t"))
    .find(([, target]) => target === session)?.[0];
  if (!viewerPane) return;

  const clients = await tmux(["list-clients", "-F", "#{client_name}\t#{pane_id}"]);
  if (!clients.ok) return;
  const popupClient = clients.stdout
    .split("\n")
    .map((line) => line.split("\t"))
    .find(([, paneId]) => paneId === viewerPane)?.[0];

  const popupArgs = popupClient ? ["-c", popupClient] : [];
  await tmux([
    "display-popup",
    ...popupArgs,
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
    `${shellQuote(process.argv[1] ?? "switchboard")} pick --target ${shellQuote(viewerPane)} --cwd ${shellQuote(cwd)}`,
  ]);
}

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { PickerApp } from "../picker/app.tsx";
import { loadPickerTheme } from "../picker/theme.ts";

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

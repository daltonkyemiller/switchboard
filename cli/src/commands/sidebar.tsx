import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { SidebarApp } from "../sidebar/app.tsx";
import { ensureOpenTuiRuntime } from "../shared/opentui-runtime.ts";

export async function runSidebar(args: readonly string[]): Promise<void> {
  const cwdFlag = args.indexOf("--cwd");
  const allFlag = args.includes("--all");
  const filterCwd = allFlag ? null : cwdFlag >= 0 ? args[cwdFlag + 1] ?? null : process.cwd();

  await ensureOpenTuiRuntime();
  const renderer = await createCliRenderer();
  createRoot(renderer).render(<SidebarApp filterCwd={filterCwd} />);
}

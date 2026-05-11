#!/usr/bin/env bun

import { realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const parserWorker = realpathSync(resolve(rootDir, "node_modules/@opentui/core/parser.worker.js"));
const workerRelativePath = relative(rootDir, parserWorker).replaceAll("\\", "/");
const bunfsRoot = process.platform === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/";

const result = await Bun.build({
  entrypoints: ["./src/index.tsx", parserWorker],
  // @ts-expect-error Current Bun types do not include compile config for Bun.build.
  compile: {
    outfile: "./dist/debug/switchboard",
  },
  sourcemap: "linked",
  define: {
    OTUI_TREE_SITTER_WORKER_PATH: JSON.stringify(`${bunfsRoot}${workerRelativePath}`),
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

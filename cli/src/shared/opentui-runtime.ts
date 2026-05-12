import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setRenderLibPath } from "@opentui/core";
import openTuiLibAsset from "../../node_modules/@opentui/core-linux-arm64/libopentui.so" with {
  type: "file",
};
import { paths } from "./paths.ts";

let setupPromise: Promise<void> | null = null;

export function ensureOpenTuiRuntime(): Promise<void> {
  setupPromise ??= setupOpenTuiRuntime();
  return setupPromise;
}

async function setupOpenTuiRuntime(): Promise<void> {
  const extension = nativeLibraryExtension();
  const libPath = join(paths.runtimeAssetsDir, `libopentui-${process.platform}-${process.arch}.${extension}`);
  await mkdir(paths.runtimeAssetsDir, { recursive: true });
  const bytes = new Uint8Array(await Bun.file(openTuiLibAsset).arrayBuffer());
  await writeFile(libPath, bytes);
  setRenderLibPath(libPath);
}

function nativeLibraryExtension(): string {
  if (process.platform === "darwin") return "dylib";
  if (process.platform === "win32") return "dll";
  return "so";
}

import { mkdir, stat, writeFile } from "node:fs/promises";
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
  const asset = Bun.file(openTuiLibAsset);
  if (!(await hasSameSize(libPath, asset.size))) {
    const bytes = new Uint8Array(await asset.arrayBuffer());
    await writeFile(libPath, bytes);
  }
  setRenderLibPath(libPath);
}

async function hasSameSize(path: string, size: number): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.size === size;
  } catch {
    return false;
  }
}

function nativeLibraryExtension(): string {
  if (process.platform === "darwin") return "dylib";
  if (process.platform === "win32") return "dll";
  return "so";
}

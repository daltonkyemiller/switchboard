import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setRenderLibPath } from "@opentui/core";

let setupPromise: Promise<void> | null = null;

export function ensureOpenTuiRuntime(): Promise<void> {
  setupPromise ??= setupOpenTuiRuntime();
  return setupPromise;
}

async function setupOpenTuiRuntime(): Promise<void> {
  const libPath = await findNativeLibraryPath();
  setRenderLibPath(libPath);
}

async function findNativeLibraryPath(): Promise<string> {
  const extension = nativeLibraryExtension();
  const libName = `libopentui.${extension}`;
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.SWITCHBOARD_OPENTUI_LIB,
    join(dirname(process.execPath), "../lib/switchboard", libName),
    join(dirname(process.execPath), "../../node_modules", nativePackageName(), libName),
    resolve(moduleDir, "../../node_modules", nativePackageName(), libName),
  ].filter((path) => path !== undefined);

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Could not find OpenTUI native library for ${process.platform}/${process.arch}`);
}

async function exists(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isFile();
  } catch {
    return false;
  }
}

function nativePackageName(): string {
  return `@opentui/core-${process.platform}-${process.arch}`;
}

function nativeLibraryExtension(): string {
  if (process.platform === "darwin") return "dylib";
  if (process.platform === "win32") return "dll";
  return "so";
}

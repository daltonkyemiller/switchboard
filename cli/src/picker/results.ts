import type { NvimContextSource } from "../shared/nvim-context.ts";

export type PickerEntryKind = "file" | "directory";

export type FileResult = {
  readonly kind: "file";
  readonly path: string;
  readonly displayDir: string;
  readonly displayName: string;
  readonly entryKind: PickerEntryKind;
  readonly reference: string;
  readonly previewPath: string | null;
  readonly source: NvimContextSource | null;
};

export type ContentResult = {
  readonly kind: "content";
  readonly path: string;
  readonly displayName: string;
  readonly lineNumber: number;
  readonly line: string;
  readonly reference: string;
  readonly previewPath: string;
};

export type PickerResult = FileResult | ContentResult;

export function trimTrailingSlash(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

export function basename(path: string): string {
  const normalized = trimTrailingSlash(path);
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function displayDir(path: string, name: string): string {
  return path.slice(0, path.length - name.length);
}

export function createFileResult(options: {
  readonly path: string;
  readonly entryKind: PickerEntryKind;
  readonly source?: NvimContextSource | null;
}): FileResult {
  const path = trimTrailingSlash(options.path);
  const displayName = basename(path);
  const isDirectory = options.entryKind === "directory";
  return {
    kind: "file",
    path,
    displayDir: displayDir(path, displayName),
    displayName,
    entryKind: options.entryKind,
    reference: `@${path}${isDirectory ? "/" : ""} `,
    previewPath: isDirectory ? null : path,
    source: options.source ?? null,
  };
}

export function createContentResult(options: {
  readonly path: string;
  readonly lineNumber: number;
  readonly line: string;
}): ContentResult {
  const path = trimTrailingSlash(options.path);
  return {
    kind: "content",
    path,
    displayName: basename(path),
    lineNumber: options.lineNumber,
    line: options.line,
    reference: `@${path}:${options.lineNumber} `,
    previewPath: path,
  };
}

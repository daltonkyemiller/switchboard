import { basename, extname } from "node:path";
import { RGBA, type ColorInput } from "@opentui/core";

export type FileIcon = {
  readonly glyph: string;
  readonly color: ColorInput;
};

const DEFAULT_ICON: FileIcon = { glyph: "󰈔", color: RGBA.fromIndex(7, "#a89984") };
const DIRECTORY_ICON: FileIcon = { glyph: "󰉋", color: RGBA.fromIndex(3, "#fabd2f") };

const BASENAME_ICONS: Record<string, FileIcon> = {
  ".env": { glyph: "󰌾", color: RGBA.fromIndex(3, "#fabd2f") },
  ".gitignore": { glyph: "󰊢", color: RGBA.fromIndex(1, "#fb4934") },
  Dockerfile: { glyph: "󰡨", color: RGBA.fromIndex(4, "#83a598") },
  Makefile: { glyph: "", color: RGBA.fromIndex(5, "#d3869b") },
  "package.json": { glyph: "", color: RGBA.fromIndex(2, "#b8bb26") },
  "tsconfig.json": { glyph: "", color: RGBA.fromIndex(4, "#83a598") },
};

const EXTENSION_ICONS: Record<string, FileIcon> = {
  ".css": { glyph: "", color: RGBA.fromIndex(4, "#83a598") },
  ".go": { glyph: "", color: RGBA.fromIndex(6, "#8ec07c") },
  ".html": { glyph: "", color: RGBA.fromIndex(1, "#fb4934") },
  ".js": { glyph: "", color: RGBA.fromIndex(3, "#fabd2f") },
  ".jsx": { glyph: "", color: RGBA.fromIndex(4, "#83a598") },
  ".json": { glyph: "", color: RGBA.fromIndex(3, "#fabd2f") },
  ".lua": { glyph: "", color: RGBA.fromIndex(4, "#83a598") },
  ".md": { glyph: "", color: RGBA.fromIndex(4, "#83a598") },
  ".rs": { glyph: "", color: RGBA.fromIndex(1, "#fb4934") },
  ".sh": { glyph: "", color: RGBA.fromIndex(2, "#b8bb26") },
  ".toml": { glyph: "", color: RGBA.fromIndex(5, "#d3869b") },
  ".ts": { glyph: "", color: RGBA.fromIndex(4, "#83a598") },
  ".tsx": { glyph: "", color: RGBA.fromIndex(4, "#83a598") },
  ".yaml": { glyph: "", color: RGBA.fromIndex(3, "#fabd2f") },
  ".yml": { glyph: "", color: RGBA.fromIndex(3, "#fabd2f") },
};

export function iconForPath(path: string, entryKind: "file" | "directory" = "file"): FileIcon {
  if (entryKind === "directory") return DIRECTORY_ICON;

  const name = basename(path);
  return BASENAME_ICONS[name] ?? EXTENSION_ICONS[extname(name).toLowerCase()] ?? DEFAULT_ICON;
}

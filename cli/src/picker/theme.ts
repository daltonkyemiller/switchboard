import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  RGBA,
  SyntaxStyle,
  convertThemeToStyles,
  type ColorInput,
  type StyleDefinitionInput,
  type ThemeTokenStyle,
} from "@opentui/core";
import { paths } from "../shared/paths.ts";

export type PickerColors = {
  readonly dimFg: ColorInput;
  readonly promptFg: ColorInput;
  readonly itemFg: ColorInput;
  readonly selectedFg: ColorInput;
  readonly selectedBg: ColorInput;
  readonly pathFg: ColorInput;
  readonly accent: ColorInput;
  readonly panelBg: ColorInput;
};

export type PickerTheme = {
  readonly colors: PickerColors;
  readonly syntaxStyle: SyntaxStyle;
  readonly nerdFontIcons: boolean;
};

type TextMateTheme = {
  readonly tokenColors?: unknown;
};

const STYLE_KEYS = new Set(["fg", "bg", "bold", "italic", "underline", "dim", "foreground", "background"]);

const DEFAULT_COLORS: PickerColors = {
  dimFg: RGBA.fromIndex(8, "#665c54"),
  promptFg: RGBA.fromIndex(3, "#fabd2f"),
  itemFg: RGBA.defaultForeground("#a89984"),
  selectedFg: RGBA.defaultForeground("#ebdbb2"),
  selectedBg: RGBA.fromIndex(0, "#3c3836"),
  pathFg: RGBA.fromIndex(8, "#7c6f64"),
  accent: RGBA.fromIndex(6, "#83a598"),
  panelBg: RGBA.defaultBackground("#1d2021"),
};

const DEFAULT_SYNTAX_STYLES: Record<string, StyleDefinitionInput> = {
  default: { fg: RGBA.defaultForeground("#ebdbb2") },
  keyword: { fg: RGBA.fromIndex(1, "#fb4934"), bold: true },
  "keyword.import": { fg: RGBA.fromIndex(1, "#fb4934"), bold: true },
  "keyword.operator": { fg: RGBA.fromIndex(1, "#fb4934") },
  string: { fg: RGBA.fromIndex(2, "#b8bb26") },
  comment: { fg: RGBA.fromIndex(8, "#665c54"), italic: true },
  number: { fg: RGBA.fromIndex(5, "#d3869b") },
  boolean: { fg: RGBA.fromIndex(5, "#d3869b") },
  constant: { fg: RGBA.fromIndex(5, "#d3869b") },
  function: { fg: RGBA.fromIndex(6, "#8ec07c") },
  "function.call": { fg: RGBA.fromIndex(6, "#8ec07c") },
  "function.method.call": { fg: RGBA.fromIndex(6, "#8ec07c") },
  type: { fg: RGBA.fromIndex(3, "#fabd2f") },
  constructor: { fg: RGBA.fromIndex(3, "#fabd2f") },
  variable: { fg: RGBA.defaultForeground("#ebdbb2") },
  "variable.member": { fg: RGBA.fromIndex(4, "#83a598") },
  property: { fg: RGBA.fromIndex(4, "#83a598") },
  operator: { fg: RGBA.fromIndex(1, "#fb4934") },
  punctuation: { fg: RGBA.defaultForeground("#ebdbb2") },
  "punctuation.bracket": { fg: RGBA.defaultForeground("#ebdbb2") },
  "punctuation.delimiter": { fg: RGBA.defaultForeground("#ebdbb2") },
  "markup.heading": { fg: RGBA.fromIndex(4, "#83a598"), bold: true },
  "markup.heading.1": { fg: RGBA.fromIndex(4, "#83a598"), bold: true, underline: true },
  "markup.heading.2": { fg: RGBA.fromIndex(6, "#8ec07c"), bold: true },
  "markup.bold": { fg: RGBA.defaultForeground("#ebdbb2"), bold: true },
  "markup.strong": { fg: RGBA.defaultForeground("#ebdbb2"), bold: true },
  "markup.italic": { fg: RGBA.defaultForeground("#ebdbb2"), italic: true },
  "markup.list": { fg: RGBA.fromIndex(1, "#fb4934") },
  "markup.quote": { fg: RGBA.fromIndex(8, "#665c54"), italic: true },
  "markup.raw": { fg: RGBA.fromIndex(2, "#b8bb26") },
  "markup.raw.block": { fg: RGBA.fromIndex(2, "#b8bb26") },
  "markup.link": { fg: RGBA.fromIndex(4, "#83a598"), underline: true },
  "markup.link.url": { fg: RGBA.fromIndex(4, "#83a598"), underline: true },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseAnsiColor(value: string): ColorInput | null {
  const match = /^ansi:(\d{1,3})$/i.exec(value);
  if (!match) return null;
  const index = Number(match[1]);
  if (!Number.isInteger(index) || index < 0 || index > 255) return null;
  return RGBA.fromIndex(index);
}

function parseColor(value: unknown): ColorInput | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255) {
    return RGBA.fromIndex(value);
  }
  const color = asString(value);
  if (!color) return null;

  const normalized = color.toLowerCase();
  if (normalized === "default" || normalized === "foreground" || normalized === "default-foreground") {
    return RGBA.defaultForeground();
  }
  if (normalized === "background" || normalized === "default-background") {
    return RGBA.defaultBackground();
  }

  return parseAnsiColor(normalized) ?? color;
}

function parseFontStyle(value: unknown): Pick<StyleDefinitionInput, "bold" | "italic" | "underline" | "dim"> {
  const fontStyle = asString(value);
  if (!fontStyle || fontStyle === "NONE") return {};
  const parts = new Set(fontStyle.toLowerCase().split(/\s+/));
  return {
    ...(parts.has("bold") ? { bold: true } : {}),
    ...(parts.has("italic") ? { italic: true } : {}),
    ...(parts.has("underline") ? { underline: true } : {}),
    ...(parts.has("dim") ? { dim: true } : {}),
  };
}

function parseStyleDefinition(value: unknown): StyleDefinitionInput | null {
  if (!isRecord(value)) return null;

  const fg = parseColor(value["fg"] ?? value["foreground"]);
  const bg = parseColor(value["bg"] ?? value["background"]);
  const bold = asBoolean(value["bold"]);
  const italic = asBoolean(value["italic"]);
  const underline = asBoolean(value["underline"]);
  const dim = asBoolean(value["dim"]);
  const fontStyle = parseFontStyle(value["font_style"] ?? value["fontStyle"]);
  const style: StyleDefinitionInput = {
    ...(fg ? { fg } : {}),
    ...(bg ? { bg } : {}),
    ...(bold !== null ? { bold } : {}),
    ...(italic !== null ? { italic } : {}),
    ...(underline !== null ? { underline } : {}),
    ...(dim !== null ? { dim } : {}),
    ...fontStyle,
  };

  return Object.keys(style).length > 0 ? style : null;
}

function parsePickerColors(value: unknown): Partial<PickerColors> {
  if (!isRecord(value)) return {};
  const dimFg = parseColor(value["dim_fg"]);
  const promptFg = parseColor(value["prompt_fg"]);
  const itemFg = parseColor(value["item_fg"]);
  const selectedFg = parseColor(value["selected_fg"]);
  const selectedBg = parseColor(value["selected_bg"]);
  const pathFg = parseColor(value["path_fg"]);
  const accent = parseColor(value["accent"]);
  const panelBg = parseColor(value["panel_bg"]);

  return {
    ...(dimFg ? { dimFg } : {}),
    ...(promptFg ? { promptFg } : {}),
    ...(itemFg ? { itemFg } : {}),
    ...(selectedFg ? { selectedFg } : {}),
    ...(selectedBg ? { selectedBg } : {}),
    ...(pathFg ? { pathFg } : {}),
    ...(accent ? { accent } : {}),
    ...(panelBg ? { panelBg } : {}),
  };
}

function parseSyntaxOverrides(value: unknown): Record<string, StyleDefinitionInput> {
  if (!isRecord(value)) return {};

  const styles: Record<string, StyleDefinitionInput> = {};
  for (const [name, styleConfig] of Object.entries(value)) {
    if (name === "theme_file") continue;
    if (STYLE_KEYS.has(name)) continue;
    const style = parseStyleDefinition(styleConfig);
    if (style) {
      styles[name] = style;
    }
  }
  return styles;
}

function resolveConfigPath(value: string): string {
  const expanded = value.startsWith("~/") ? join(process.env["HOME"] ?? "", value.slice(2)) : value;
  if (isAbsolute(expanded)) return expanded;
  return resolve(dirname(paths.configFile), expanded);
}

function asScopeArray(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0);
  }
  if (!Array.isArray(value)) return [];
  return value.filter((scope): scope is string => typeof scope === "string" && scope.length > 0);
}

function parseTokenColor(value: unknown): ThemeTokenStyle | null {
  if (!isRecord(value)) return null;
  const scope = asScopeArray(value["scope"]);
  const settings = isRecord(value["settings"]) ? value["settings"] : null;
  if (scope.length === 0 || !settings) return null;

  const foreground = parseColor(settings["foreground"]);
  const background = parseColor(settings["background"]);
  const fontStyle = parseFontStyle(settings["fontStyle"]);
  if (!foreground && !background && Object.keys(fontStyle).length === 0) return null;

  return {
    scope,
    style: {
      ...(foreground ? { foreground } : {}),
      ...(background ? { background } : {}),
      ...fontStyle,
    },
  };
}

async function loadThemeFile(path: string): Promise<Record<string, StyleDefinitionInput>> {
  const raw = await readFile(resolveConfigPath(path), "utf8");
  const parsed: unknown = JSON.parse(raw);
  const theme: TextMateTheme = isRecord(parsed) ? parsed : {};
  const tokenColors = Array.isArray(theme.tokenColors) ? theme.tokenColors : [];
  const tokens = tokenColors.flatMap((token) => {
    const parsedToken = parseTokenColor(token);
    return parsedToken ? [parsedToken] : [];
  });
  return convertThemeToStyles(tokens);
}

export async function loadPickerTheme(): Promise<PickerTheme> {
  let raw = "";
  try {
    raw = await readFile(paths.configFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const parsed: unknown = raw.trim().length > 0 ? Bun.TOML.parse(raw) : {};
  const root = isRecord(parsed) ? parsed : {};
  const picker = isRecord(root["picker"]) ? root["picker"] : {};
  const nerdFontIcons = asBoolean(picker["nerd_font_icons"]) ?? true;
  const colors = { ...DEFAULT_COLORS, ...parsePickerColors(picker["theme"]) };
  const syntaxConfig = isRecord(picker["syntax"]) ? picker["syntax"] : {};
  const themeFile = asString(syntaxConfig["theme_file"]);
  const importedSyntax = themeFile ? await loadThemeFile(themeFile) : {};
  const syntaxStyles = {
    ...DEFAULT_SYNTAX_STYLES,
    ...importedSyntax,
    ...parseSyntaxOverrides(syntaxConfig),
  };

  return {
    colors,
    syntaxStyle: SyntaxStyle.fromStyles(syntaxStyles),
    nerdFontIcons,
  };
}

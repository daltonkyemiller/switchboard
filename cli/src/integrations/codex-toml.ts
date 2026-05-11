const HOOK_KEY = "codex_hooks";
const FEATURES_HEADER = "[features]";

function isTomlKey(line: string, key: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith("#") || !trimmed.startsWith(key)) return false;
  return trimmed.slice(key.length).trimStart().startsWith("=");
}

export function ensureCodexHooksEnabled(content: string): string {
  const trailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (trailingNewline) lines.pop();

  const keyIndex = lines.findIndex((line) => isTomlKey(line, HOOK_KEY));
  if (keyIndex !== -1) {
    lines[keyIndex] = `${HOOK_KEY} = true`;
    return `${lines.join("\n")}${trailingNewline || lines.length === 0 ? "\n" : ""}`;
  }

  const featuresIndex = lines.findIndex((line) => line.trim() === FEATURES_HEADER);
  if (featuresIndex !== -1) {
    lines.splice(featuresIndex + 1, 0, `${HOOK_KEY} = true`);
    return `${lines.join("\n")}${trailingNewline || lines.length === 0 ? "\n" : ""}`;
  }

  const trimmed = content.replace(/\n+$/, "");
  const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : "";
  return `${prefix}${FEATURES_HEADER}\n${HOOK_KEY} = true\n`;
}

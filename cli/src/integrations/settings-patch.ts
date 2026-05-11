type HookCommand = {
  readonly type: "command";
  readonly command: string;
  readonly timeout?: number;
};

type HookEntry = {
  readonly matcher?: string;
  readonly hooks: readonly HookCommand[];
};

type HooksObject = Record<string, HookEntry[]>;

type SettingsLike = Record<string, unknown> & { hooks?: unknown };

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function ensureHooksMap(settings: SettingsLike, label: string): HooksObject {
  if (settings.hooks === undefined) {
    settings.hooks = {};
  }
  const hooksObj = asObject(settings.hooks);
  if (!hooksObj) {
    throw new Error(`${label} "hooks" must be an object`);
  }
  return hooksObj as HooksObject;
}

function entryMatchesCommand(entry: HookEntry, command: string): boolean {
  return entry.hooks.some((h) => h.type === "command" && h.command === command);
}

export function ensureCommandHook(
  settings: SettingsLike,
  event: string,
  command: string,
  options: { readonly timeout?: number; readonly matcher?: string },
  label = "settings",
): void {
  const hooks = ensureHooksMap(settings, label);
  const existing = hooks[event];
  if (existing) {
    if (!Array.isArray(existing)) {
      throw new Error(`${label} hooks.${event} must be an array`);
    }
    if (existing.some((entry) => entryMatchesCommand(entry, command))) return;
  } else {
    hooks[event] = [];
  }

  const entry: HookEntry = {
    ...(options.matcher !== undefined ? { matcher: options.matcher } : {}),
    hooks: [
      {
        type: "command",
        command,
        ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
      },
    ],
  };
  hooks[event]?.push(entry);
}

export function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

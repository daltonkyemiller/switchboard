import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { basename, dirname, join } from "node:path";

type UninstallOptions = {
  readonly prefix: string;
  readonly tmuxPluginDir: string;
  readonly dryRun: boolean;
  readonly yes: boolean;
};

type RemoveStep = {
  readonly command: "rm" | "rmdir";
  readonly args: readonly string[];
  readonly path: string;
  readonly ignoreFailure: boolean;
};

export async function runUninstall(args: readonly string[]): Promise<void> {
  const options = parseOptions(args);
  const steps = buildRemoveSteps(options);

  console.error("switchboard uninstall will remove:");
  for (const step of steps) {
    console.error(`  ${step.path}`);
  }

  if (options.dryRun) {
    return;
  }

  if (!options.yes) {
    await confirmUninstall();
  }

  for (const step of steps) {
    await runRemoveStep(step);
  }

  console.error("switchboard uninstalled");
}

function parseOptions(args: readonly string[]): UninstallOptions {
  let prefix = process.env["PREFIX"] ?? inferInstallPrefix();
  let tmuxPluginDir = process.env["TMUX_PLUGIN_DIR"] ?? join(requiredHome(), ".tmux/plugins/switchboard");
  let dryRun = false;
  let yes = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--prefix") {
      prefix = requireValue(args, index, "--prefix");
      index += 1;
      continue;
    }

    if (arg === "--tmux-plugin-dir") {
      tmuxPluginDir = requireValue(args, index, "--tmux-plugin-dir");
      index += 1;
      continue;
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--yes" || arg === "-y") {
      yes = true;
      continue;
    }

    throw new Error(`unknown uninstall option: ${arg}`);
  }

  return { prefix, tmuxPluginDir, dryRun, yes };
}

function requireValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function inferInstallPrefix(): string {
  const binaryDir = dirname(process.execPath);
  if (basename(process.execPath) === "switchboard" && basename(binaryDir) === "bin") {
    return dirname(binaryDir);
  }

  return "/usr/local";
}

function requiredHome(): string {
  const home = process.env["HOME"];
  if (!home) {
    throw new Error("HOME is not set");
  }
  return home;
}

function buildRemoveSteps(options: UninstallOptions): readonly RemoveStep[] {
  const binaryPath = join(options.prefix, "bin/switchboard");
  const nativeLibraryPath = join(options.prefix, "lib/switchboard/libopentui.so");
  const nativeLibraryDir = join(options.prefix, "lib/switchboard");
  const pluginPath = join(options.tmuxPluginDir, "plugin.tmux");

  return [
    { command: "rm", args: ["-f", binaryPath], path: binaryPath, ignoreFailure: false },
    { command: "rm", args: ["-f", nativeLibraryPath], path: nativeLibraryPath, ignoreFailure: false },
    { command: "rmdir", args: [nativeLibraryDir], path: nativeLibraryDir, ignoreFailure: true },
    { command: "rm", args: ["-f", pluginPath], path: pluginPath, ignoreFailure: false },
    { command: "rmdir", args: [options.tmuxPluginDir], path: options.tmuxPluginDir, ignoreFailure: true },
  ];
}

async function confirmUninstall(): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error("refusing to uninstall without a TTY; pass --yes to confirm");
  }

  const readline = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await readline.question("Continue? [y/N] ");
  readline.close();

  if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
    throw new Error("uninstall cancelled");
  }
}

async function runRemoveStep(step: RemoveStep): Promise<void> {
  if (!(await exists(step.path)) && step.command === "rmdir") {
    return;
  }

  const command = await needsSudo(step.path) ? ["sudo", step.command, ...step.args] : [step.command, ...step.args];
  const result = Bun.spawnSync({ cmd: command, stdout: "inherit", stderr: "inherit" });

  if (!result.success && !step.ignoreFailure) {
    process.exit(result.exitCode);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function needsSudo(path: string): Promise<boolean> {
  if (await canWrite(path)) {
    return false;
  }

  if (await exists(path)) {
    return true;
  }

  return !(await canWrite(dirname(path)));
}

async function canWrite(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

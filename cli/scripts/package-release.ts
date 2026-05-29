#!/usr/bin/env bun

import { chmodSync, cpSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ReleaseTarget = {
  readonly name: string;
  readonly bunTarget: string;
};

const releaseTargets = [
  { name: "linux-x64", bunTarget: "bun-linux-x64" },
  { name: "linux-arm64", bunTarget: "bun-linux-arm64" },
] satisfies readonly ReleaseTarget[];

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cliDir = resolve(scriptDir, "..");
const repoDir = resolve(cliDir, "..");
const releaseDir = resolve(cliDir, "dist/release");
const parserWorker = realpathSync(resolve(cliDir, "node_modules/@opentui/core/parser.worker.js"));
const workerRelativePath = relative(cliDir, parserWorker).replaceAll("\\", "/");
const bunfsRoot = process.platform === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/";
const requestedTarget = process.argv[2];
const getHostTargetName = () => {
  if (process.platform !== "linux") {
    return undefined;
  }

  if (process.arch === "x64") {
    return "linux-x64";
  }

  if (process.arch === "arm64") {
    return "linux-arm64";
  }

  return undefined;
};

const hostTargetName = getHostTargetName();

const selectedTargets =
  requestedTarget === undefined
    ? releaseTargets.filter((target) => target.name === hostTargetName)
    : releaseTargets.filter((target) => target.name === requestedTarget);

if (selectedTargets.length === 0) {
  if (requestedTarget === undefined) {
    console.error(`Unsupported release host: ${process.platform}/${process.arch}`);
    process.exit(1);
  }

  const targetNames = releaseTargets.map((target) => target.name).join(", ");
  console.error(`Unknown release target "${requestedTarget}". Expected one of: ${targetNames}`);
  process.exit(1);
}

if (requestedTarget !== undefined && requestedTarget !== hostTargetName) {
  console.error(
    `Cannot package ${requestedTarget} on ${process.platform}/${process.arch}. OpenTUI installs native dependencies for the host architecture, so release packaging must run on a matching runner.`,
  );
  process.exit(1);
}

mkdirSync(releaseDir, { recursive: true });

for (const target of selectedTargets) {
  const packageName = `switchboard-${target.name}`;
  const packageDir = resolve(releaseDir, packageName);
  const binaryPath = resolve(packageDir, "bin/switchboard");
  const archivePath = resolve(releaseDir, `${packageName}.tar.gz`);

  rmSync(packageDir, { force: true, recursive: true });
  rmSync(archivePath, { force: true });
  mkdirSync(resolve(packageDir, "bin"), { recursive: true });

  const result = await Bun.build({
    entrypoints: ["./src/index.tsx", parserWorker],
    // @ts-expect-error Current locked Bun types do not include compile config for Bun.build.
    compile: {
      target: target.bunTarget,
      outfile: binaryPath,
    },
    define: {
      OTUI_TREE_SITTER_WORKER_PATH: JSON.stringify(`${bunfsRoot}${workerRelativePath}`),
    },
    minify: true,
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  chmodSync(binaryPath, 0o755);
  cpSync(resolve(repoDir, "plugin.tmux"), resolve(packageDir, "plugin.tmux"));
  cpSync(resolve(repoDir, "README.md"), resolve(packageDir, "README.md"));
  mkdirSync(resolve(packageDir, "docs"), { recursive: true });
  cpSync(resolve(repoDir, "docs/configuration.md"), resolve(packageDir, "docs/configuration.md"));

  const archive = Bun.spawnSync({
    cmd: ["tar", "-czf", archivePath, "-C", releaseDir, packageName],
    stdout: "inherit",
    stderr: "inherit",
  });

  if (!archive.success) {
    process.exit(archive.exitCode);
  }

  console.log(`Created ${basename(archivePath)}`);
}

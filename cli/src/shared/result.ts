import { Result } from "@praha/byethrow";
import type { TmuxResult } from "./tmux.ts";

export type CliError = {
  readonly message: string;
  readonly cause?: unknown;
};

export type CliResult<T> = Result.Result<T, CliError>;
export type CliResultAsync<T> = Result.ResultAsync<T, CliError>;

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function cliError(message: string, cause?: unknown): CliError {
  return cause === undefined ? { message } : { message: `${message}: ${errorMessage(cause)}`, cause };
}

export function fail<T = never>(message: string, cause?: unknown): CliResult<T> {
  return Result.fail(cliError(message, cause));
}

export function succeed<T>(value: T): CliResult<T> {
  return { type: "Success", value };
}

export function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export function fromTmux(result: TmuxResult, message: string): CliResult<TmuxResult> {
  if (result.ok) return succeed(result);
  return fail(result.stderr || message);
}

export function unwrapOrExit<T>(result: CliResult<T>): T {
  if (Result.isSuccess(result)) return result.value;
  console.error(result.error.message);
  process.exit(1);
}

export async function unwrapAsyncOrExit<T>(result: CliResultAsync<T>): Promise<T> {
  const resolved = await result;
  return unwrapOrExit(resolved);
}

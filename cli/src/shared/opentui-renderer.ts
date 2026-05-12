import { createCliRenderer } from "@opentui/core";

const THEME_MODE_NOTIFICATION = /^\x1b\[\?997;[12]n$/;

function createPaletteSafeStdout(): NodeJS.WriteStream {
  const stdout = Object.create(process.stdout) as NodeJS.WriteStream & { isTTY?: boolean };
  Object.defineProperty(stdout, "isTTY", {
    configurable: true,
    value: false,
  });
  return stdout;
}

export function createSwitchboardRenderer() {
  return createCliRenderer({
    stdout: createPaletteSafeStdout(),
    useKittyKeyboard: null,
    prependInputHandlers: [(sequence) => THEME_MODE_NOTIFICATION.test(sequence)],
  });
}

"use strict";

const childProcess = require("node:child_process");
const { syncBuiltinESMExports } = require("node:module");

const installed = Symbol.for("money-flow.e2e.windows-hide-child-processes");

function hidden(options) {
  return { ...(options || {}), windowsHide: true };
}

if (process.platform === "win32" && !childProcess[installed]) {
  const original = {
    execFileSync: childProcess.execFileSync,
    spawn: childProcess.spawn,
    spawnSync: childProcess.spawnSync,
  };

  childProcess.spawn = (command, args, options) =>
    Array.isArray(args)
      ? original.spawn(command, args, hidden(options))
      : original.spawn(command, hidden(args));

  childProcess.spawnSync = (command, args, options) =>
    Array.isArray(args)
      ? original.spawnSync(command, args, hidden(options))
      : original.spawnSync(command, hidden(args));

  childProcess.execFileSync = (file, args, options) =>
    Array.isArray(args)
      ? original.execFileSync(file, args, hidden(options))
      : original.execFileSync(file, [], hidden(args));

  Object.defineProperty(childProcess, installed, { value: true });
  syncBuiltinESMExports();
}

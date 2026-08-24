import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const update = await import("../../bin/cli/commands/update.mjs");

// #11335: `omniroute update` failed on Windows with "Could not check latest
// version. Is npm available?" even though npm worked fine. getLatestVersion()
// ran execFile("npm", ...) without a shell; on Node ≥24 spawning npm.cmd
// without a shell throws EINVAL/ENOENT (nodejs/node#52554, see #5379). The
// fix enables the shell on win32 only, mirroring the CLI fixes from
// #7913/#6263/#6304.
test("getLatestVersion enables the shell on win32 (#11335)", async () => {
  let captured = null;
  const fakeExec = async (cmd: string, args: string[], opts: Record<string, unknown>) => {
    captured = { cmd, args, opts };
    return { stdout: "3.8.49\n" };
  };
  const latest = await update.getLatestVersion(fakeExec, "win32");
  assert.equal(latest, "3.8.49");
  assert.ok(captured, "exec must be invoked");
  assert.equal(captured.cmd, "npm");
  assert.ok(
    captured.args.includes("--prefer-online"),
    `expected --prefer-online in npm args, got: ${JSON.stringify(captured.args)}`
  );
  assert.equal(
    captured.opts.shell,
    true,
    "win32 must enable the shell so npm.cmd resolves (no EINVAL/ENOENT)"
  );
  assert.equal(captured.opts.timeout, 15000);
});

test("getLatestVersion leaves the shell disabled off win32 (#11335)", async () => {
  let captured = null;
  const fakeExec = async (_cmd: string, _args: string[], opts: Record<string, unknown>) => {
    captured = { opts };
    return { stdout: "3.8.49\n" };
  };
  await update.getLatestVersion(fakeExec, "linux");
  assert.ok(captured, "exec must be invoked");
  assert.notEqual(captured.opts.shell, true, "non-win32 must not enable the shell");
});

test("#11335 both npm lookups in update.mjs wire the win32 shell", () => {
  const src = fs.readFileSync(
    new URL("../../bin/cli/commands/update.mjs", import.meta.url),
    "utf8"
  );
  assert.ok(
    src.includes('shell: platform === "win32"'),
    "getLatestVersion must enable the shell on win32"
  );
  assert.ok(
    src.includes('shell: process.platform === "win32"'),
    "changelog lookup must enable the shell on win32"
  );
});

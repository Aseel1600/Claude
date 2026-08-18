import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  buildNotifyMessage,
  createSystemdNotifier,
  isSystemdNotifyEnabled,
  SD_NOTIFY_WATCHDOG_INTERVAL_MS,
} from "../../scripts/dev/systemd-notify.mjs";

function fakeSpawn(recorder) {
  return (binary, args, options) => {
    const child = new EventEmitter();
    recorder.push({ binary, args, options, child });
    return child;
  };
}

test("isSystemdNotifyEnabled: false without NOTIFY_SOCKET", () => {
  assert.equal(isSystemdNotifyEnabled({}), false);
  assert.equal(isSystemdNotifyEnabled({ OMNIROUTE_DISABLE_SD_NOTIFY: "0" }), false);
});

test("isSystemdNotifyEnabled: true when NOTIFY_SOCKET is set", () => {
  assert.equal(isSystemdNotifyEnabled({ NOTIFY_SOCKET: "/run/systemd/notify" }), true);
});

test("isSystemdNotifyEnabled: opt-out OMNIROUTE_DISABLE_SD_NOTIFY=1 wins", () => {
  assert.equal(
    isSystemdNotifyEnabled({
      NOTIFY_SOCKET: "/run/systemd/notify",
      OMNIROUTE_DISABLE_SD_NOTIFY: "1",
    }),
    false
  );
});

test("notifier honors the opt-out (no spawn, no timer)", async () => {
  const calls = [];
  const notifier = createSystemdNotifier({
    env: { NOTIFY_SOCKET: "/run/systemd/notify", OMNIROUTE_DISABLE_SD_NOTIFY: "1" },
    spawnFn: fakeSpawn(calls),
  });
  assert.equal(notifier.enabled, false);
  notifier.ready();
  notifier.startWatchdog();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(calls, []);
  notifier.dispose();
});

// Contract with the generated systemd unit (bin/cli/tray/autostart.mjs):
// systemd requires keep-alive pings at most every WatchdogSec/2, and the
// generated unit pins WatchdogSec=180. If either side drifts, this fails
// loudly instead of silently breaking the watchdog.
test("watchdog cadence satisfies the generated unit's WatchdogSec", () => {
  const generatedWatchdogSec = 180;
  assert.ok(
    2 * SD_NOTIFY_WATCHDOG_INTERVAL_MS <= generatedWatchdogSec * 1000,
    `ping interval ${SD_NOTIFY_WATCHDOG_INTERVAL_MS}ms must be <= WatchdogSec/2 (${generatedWatchdogSec / 2}s)`
  );
});

test("buildNotifyMessage: known kinds", () => {
  assert.equal(buildNotifyMessage("ready"), "READY=1");
  assert.equal(buildNotifyMessage("watchdog"), "WATCHDOG=1");
  assert.equal(buildNotifyMessage("stopping"), "STOPPING=1");
});

test("buildNotifyMessage: unknown kind throws", () => {
  assert.throws(() => buildNotifyMessage("bogus"), /unknown message kind/);
});

test("disabled notifier is a complete no-op (no spawn, no timer)", async () => {
  const calls = [];
  const notifier = createSystemdNotifier({ env: {}, spawnFn: fakeSpawn(calls) });
  assert.equal(notifier.enabled, false);
  notifier.ready();
  notifier.watchdog();
  notifier.stopping();
  notifier.startWatchdog();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(calls, []);
  notifier.dispose();
});

test("enabled notifier sends the right message per kind", () => {
  const calls = [];
  const env = { NOTIFY_SOCKET: "/run/systemd/notify" };
  const notifier = createSystemdNotifier({ env, spawnFn: fakeSpawn(calls) });
  assert.equal(notifier.enabled, true);
  notifier.ready();
  notifier.watchdog();
  notifier.stopping();
  assert.deepEqual(
    calls.map((c) => c.args),
    [["READY=1"], ["WATCHDOG=1"], ["STOPPING=1"]]
  );
  calls.forEach((c) => {
    assert.equal(c.binary, "systemd-notify");
    assert.equal(c.options.env, env);
    assert.deepEqual(c.options.stdio, "ignore");
  });
});

test("spawn failure disables the notifier once and stops the watchdog", async () => {
  const calls = [];
  const warnings = [];
  const env = { NOTIFY_SOCKET: "/run/systemd/notify" };
  const notifier = createSystemdNotifier({
    env,
    spawnFn: fakeSpawn(calls),
    onWarn: (m) => warnings.push(m),
  });
  notifier.ready();
  calls[0].child.emit("error", { code: "ENOENT" });
  assert.equal(notifier.enabled, true); // env guard unchanged
  notifier.watchdog();
  notifier.stopping();
  notifier.startWatchdog();
  assert.equal(calls.length, 1, "no further spawn after disable");
  assert.equal(warnings.length, 1, "warning emitted exactly once");
  assert.match(warnings[0], /ENOENT/);
  notifier.dispose();
});

test("watchdog interval pings repeatedly and dispose() stops it", async () => {
  const calls = [];
  const env = { NOTIFY_SOCKET: "/run/systemd/notify" };
  const notifier = createSystemdNotifier({
    env,
    watchdogIntervalMs: 5,
    spawnFn: fakeSpawn(calls),
  });
  notifier.ready();
  notifier.startWatchdog();
  await new Promise((resolve) => setTimeout(resolve, 25));
  notifier.dispose();
  const watchdogCalls = calls.filter((c) => c.args[0] === "WATCHDOG=1").length;
  assert.ok(watchdogCalls >= 2, `expected >= 2 watchdog pings, got ${watchdogCalls}`);
  const before = calls.length;
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(calls.length, before, "no ping after dispose");
});

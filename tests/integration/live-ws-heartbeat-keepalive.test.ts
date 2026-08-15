// Integration test for #10319: a healthy, subscribed-but-otherwise-silent LiveWS
// client must never be terminated by the server's heartbeat sweep. Uses the same
// spawn-the-real-server harness pattern as tests/integration/live-ws-startup.test.ts
// (serial, --test-concurrency=1 integration runner — this test needs a ~50s window
// to cross the server's HEARTBEAT_TIMEOUT_MS, which is intentionally NOT inflated
// here; do not shrink this test's window to "make it fast" — that would stop
// exercising the real timeout).
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";
import test from "node:test";
import WebSocket from "ws";

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("Failed to allocate a local port"));
      });
    });
  });
}

function terminateTree(child: ChildProcessWithoutNullStreams): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

function waitForStartup(
  child: ChildProcessWithoutNullStreams,
  getOutput: () => string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`LiveWS startup timed out. Output:\n${getOutput()}`));
    }, 30_000);

    const onData = () => {
      const output = getOutput();
      if (output.includes("Dashboard WebSocket server listening")) {
        cleanup();
        resolve();
      }
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(`LiveWS exited before listening: code=${code} signal=${signal}\n${getOutput()}`)
      );
    };

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("exit", onExit);
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", onExit);
    onData();
  });
}

test(
  "LiveWS keeps a subscribed-but-silent client connected past the heartbeat timeout (#10319)",
  { timeout: 65_000 },
  async () => {
    const port = await getFreePort();
    const apiKey = "test-live-ws-heartbeat-key";
    const jwtSecret = "test-live-ws-heartbeat-jwt-secret";
    const origin = "http://localhost";
    let output = "";

    const child = spawn(process.execPath, ["scripts/start-ws-server.mjs"], {
      cwd: process.cwd(),
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        NODE_ENV: "test",
        OMNIROUTE_API_KEY: apiKey,
        JWT_SECRET: jwtSecret,
        LIVE_WS_HOST: "127.0.0.1",
        LIVE_WS_PORT: String(port),
        LIVE_WS_ALLOWED_ORIGINS: origin,
      },
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });

    try {
      await waitForStartup(child, () => output);

      let closed = false;
      let closeCode: number | undefined;

      const welcomeReceived = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Timed out waiting for welcome. Output:\n${output}`));
        }, 5_000);

        const ws = new WebSocket(`ws://127.0.0.1:${port}/live-ws`, {
          headers: { Authorization: `Bearer ${apiKey}`, Origin: origin },
        });

        ws.once("open", () => {
          ws.send(JSON.stringify({ type: "subscribe", channels: ["requests"] }));
        });

        ws.on("message", (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === "welcome") {
            clearTimeout(timeout);
            resolve();
          }
        });

        ws.once("close", (code) => {
          closed = true;
          closeCode = code;
        });

        ws.once("error", (error) => {
          clearTimeout(timeout);
          reject(new Error(`LiveWS client failed: ${error.message}. Output:\n${output}`));
        });

        // Deliberately stay silent after subscribing — this models the buggy
        // client (never pings). The FIX under test lives server-side: the
        // server's own outbound heartbeat pong now refreshes lastActivity, so
        // even a silent client must not be terminated.
      });

      await welcomeReceived;

      // Wait past HEARTBEAT_TIMEOUT_MS (35s) + a full HEARTBEAT_INTERVAL_MS (15s)
      // margin so at least one heartbeat sweep has had the chance to (wrongly)
      // terminate an idle-but-healthy connection.
      await new Promise((resolve) => setTimeout(resolve, 50_000));

      assert.equal(
        closed,
        false,
        `Silent-but-subscribed client was terminated (closeCode=${closeCode}) — #10319 regressed. Output:\n${output}`
      );
    } finally {
      terminateTree(child);
    }
  }
);

// Issue #11766: waitForServer currently probes only 127.0.0.1, so an OmniRoute
// process bound only to the IPv6 loopback (::1) is invisible to CLI readiness.
// This file is .mjs so bare `node --test` can import the real CLI ESM module with
// no tsx or installed dependencies. Cases 1, 3, and 6 are expected RED until the
// dual-loopback fix lands; cases 2, 4, and 5 are intentionally green guards.

import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";

import { waitForServer } from "../../bin/cli/utils/pid.mjs";

const HEALTH_PATH = "/api/monitoring/health";
const DUAL_PORT_ATTEMPTS = 20;

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeServer(server, sockets = new Set()) {
  if (!server.listening) return Promise.resolve();

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    for (const socket of sockets) socket.destroy();
    server.closeAllConnections?.();
  });
}

async function supportsIpv6Loopback(t) {
  const probe = net.createServer();
  try {
    await listen(probe, 0, "::1");
    return true;
  } catch (error) {
    if (error?.code === "EADDRNOTAVAIL" || error?.code === "EAFNOSUPPORT") {
      t.skip("IPv6 loopback unavailable");
      return false;
    }
    throw error;
  } finally {
    await closeServer(probe);
  }
}

async function freePortOnBothLoopbacks() {
  let lastError;

  for (let attempt = 0; attempt < DUAL_PORT_ATTEMPTS; attempt += 1) {
    const ipv4 = net.createServer();
    const ipv6 = net.createServer();
    try {
      await listen(ipv4, 0, "127.0.0.1");
      const address = ipv4.address();
      assert.ok(
        address && typeof address !== "string",
        "#11766: expected an IPv4 ephemeral address while allocating a dual-loopback port"
      );
      await listen(ipv6, address.port, "::1");
      return address.port;
    } catch (error) {
      lastError = error;
      if (error?.code !== "EADDRINUSE") throw error;
    } finally {
      await closeServer(ipv6);
      await closeServer(ipv4);
    }
  }

  throw new Error(
    `#11766: could not find a port bindable on both loopbacks after ${DUAL_PORT_ATTEMPTS} attempts`,
    { cause: lastError }
  );
}

function createHealthServer() {
  return http.createServer((request, response) => {
    if (request.url === HEALTH_PATH) {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
      return;
    }
    response.writeHead(404);
    response.end();
  });
}

test("#11766: waitForServer reports ready when only the IPv6 loopback serves health 200", async (t) => {
  if (!(await supportsIpv6Loopback(t))) return;

  const server = createHealthServer();
  await listen(server, 0, "::1");
  const address = server.address();
  assert.ok(
    address && typeof address !== "string",
    "#11766: expected the IPv6-only health fixture to expose its bound port"
  );
  const { port } = address;

  try {
    const ipv6Response = await fetch(`http://[::1]:${port}${HEALTH_PATH}`);
    assert.equal(
      ipv6Response.status,
      200,
      "#11766: sanity check expected the IPv6-only health fixture to return HTTP 200"
    );
    await assert.rejects(
      fetch(`http://127.0.0.1:${port}${HEALTH_PATH}`),
      "#11766: sanity check expected the IPv6-only health fixture to refuse IPv4"
    );

    assert.equal(
      await waitForServer(port, 8000),
      true,
      "#11766: waitForServer should report ready when health 200 is served only on ::1"
    );
  } finally {
    await closeServer(server);
  }
});

test("#11766: waitForServer still reports ready for an IPv4-only health 200", async () => {
  const server = createHealthServer();
  await listen(server, 0, "127.0.0.1");
  const address = server.address();
  assert.ok(
    address && typeof address !== "string",
    "#11766: expected the IPv4-only health fixture to expose its bound port"
  );

  try {
    assert.equal(
      await waitForServer(address.port, 8000),
      true,
      "#11766: waitForServer should preserve readiness for an IPv4-only health 200"
    );
  } finally {
    await closeServer(server);
  }
});

test("#11766: an IPv6-only fast-reject still earns the 3s route-mount grace", async (t) => {
  if (!(await supportsIpv6Loopback(t))) return;

  const server = net.createServer((socket) => socket.destroy());
  await listen(server, 0, "::1");
  const address = server.address();
  assert.ok(
    address && typeof address !== "string",
    "#11766: expected the IPv6 fast-reject fixture to expose its bound port"
  );

  try {
    assert.equal(
      await waitForServer(address.port, 8000),
      true,
      "#11766: an IPv6-only fast-reject should earn the shared 3s route-mount grace"
    );
  } finally {
    await closeServer(server);
  }
});

test("#11766/#6800: an IPv4-only accept-never-respond socket stays not-ready once the IPv6 probe is added", async () => {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("data", () => {});
  });
  await listen(server, 0, "127.0.0.1");
  const address = server.address();
  assert.ok(
    address && typeof address !== "string",
    "#11766/#6800: expected the hanging IPv4 fixture to expose its bound port"
  );

  try {
    // Intentionally-green forward guard: a dual-family implementation must not
    // classify this hanging IPv4 socket as ready via a shared or other-family
    // listening fallback, which would silently reverse the #6800 protection.
    assert.equal(
      await waitForServer(address.port, 8000),
      false,
      "#11766/#6800: a hanging IPv4 socket must remain not-ready after adding IPv6 probes"
    );
  } finally {
    await closeServer(server, sockets);
  }
});

test("#11766: neither loopback family listening stays not-ready", async (t) => {
  if (!(await supportsIpv6Loopback(t))) return;

  const port = await freePortOnBothLoopbacks();
  assert.equal(
    await waitForServer(port, 1500),
    false,
    "#11766: waitForServer must stay not-ready when neither loopback family is listening"
  );
});

test("#11766: a health 200 on one family wins over a hanging sibling on the other", async (t) => {
  if (!(await supportsIpv6Loopback(t))) return;

  const port = await freePortOnBothLoopbacks();
  const ipv6Server = createHealthServer();
  const ipv4Sockets = new Set();
  const ipv4Server = net.createServer((socket) => {
    ipv4Sockets.add(socket);
    socket.once("close", () => ipv4Sockets.delete(socket));
    socket.on("data", () => {});
  });

  try {
    try {
      await listen(ipv6Server, port, "::1");
      await listen(ipv4Server, port, "127.0.0.1");
    } catch (error) {
      if (error?.code === "EADDRINUSE") {
        t.skip("#11766: dual-loopback fixture port was claimed before both binds completed");
        return;
      }
      throw error;
    }

    assert.equal(
      await waitForServer(port, 8000),
      true,
      "#11766: an IPv6 health 200 must outrank a hanging IPv4 sibling probe"
    );
  } finally {
    await closeServer(ipv4Server, ipv4Sockets);
    await closeServer(ipv6Server);
  }
});

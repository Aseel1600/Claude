import assert from "node:assert/strict";
import test from "node:test";

import { fetchRemoteMedia } from "../../src/shared/network/remoteImageFetch.ts";

test("generic remote-media fetch reuses the public-only bounded download policy", async () => {
  const result = await fetchRemoteMedia("https://cdn.example.test/video.mp4", {
    fetchImpl: async () =>
      new Response(Buffer.from("video-bytes"), {
        headers: { "content-type": "video/mp4" },
      }),
    guard: "public-only",
    lookup: async () => [{ address: "203.0.113.10", family: 4 }],
    maxBytes: 1024,
  });

  assert.equal(result.buffer.toString(), "video-bytes");
  assert.equal(result.contentType, "video/mp4");
});

test("generic remote-media fetch rejects private DNS answers before downloading", async () => {
  let fetched = false;
  await assert.rejects(
    () =>
      fetchRemoteMedia("https://cdn.example.test/video.mp4", {
        fetchImpl: async () => {
          fetched = true;
          return new Response("unexpected");
        },
        guard: "public-only",
        lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      }),
    /blocked private address/
  );
  assert.equal(fetched, false);
});

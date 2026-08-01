// Regression tests for provider-node eligibility on the /v1/audio/* routes.
//
// All three audio routes carried an identical filter that accepted only nodes typed
// `chat`/`responses`. A node explicitly typed `audio-transcriptions` was therefore
// rejected by the very route it exists for, its models never entered the dynamic
// provider list, and a bare model name fell through to the hardcoded registry —
// where an unrelated provider owning a model literally named `whisper` silently won.
//
// The second axis is the host guard: loopback nodes stay always-eligible, remote
// nodes are opt-in via AUDIO_REMOTE_PROVIDER_NODES (default OFF) because routing
// audio to an arbitrary remote host changes egress identity.

import test from "node:test";
import assert from "node:assert/strict";

import {
  isLocalAudioNodeHost,
  selectAudioProviderNodes,
} from "@/app/api/v1/_shared/audioProviderNodes";
import type { ProviderNodeRow } from "@omniroute/open-sse/config/audioRegistry.ts";

const LOCAL_AUDIO_NODE: ProviderNodeRow = {
  id: "openai-compatible-audio-transcriptions-local",
  prefix: "localstt",
  name: "Local STT",
  baseUrl: "http://localhost:9000/v1",
  apiType: "audio-transcriptions",
};

const REMOTE_AUDIO_NODE: ProviderNodeRow = {
  id: "openai-compatible-audio-transcriptions-remote",
  prefix: "remotestt",
  name: "Remote STT",
  baseUrl: "https://stt.example.com/v1",
  apiType: "audio-transcriptions",
};

const LOCAL_CHAT_NODE: ProviderNodeRow = {
  id: "openai-compatible-chat-local",
  prefix: "localchat",
  name: "Local multimodal gateway",
  baseUrl: "http://127.0.0.1:11434/v1",
  apiType: "chat",
};

const LOCAL_EMBEDDINGS_NODE: ProviderNodeRow = {
  id: "openai-compatible-embeddings-local",
  prefix: "localembed",
  name: "Local embeddings",
  baseUrl: "http://localhost:9100/v1",
  apiType: "embeddings",
};

function select(nodes: ProviderNodeRow[], allowRemote = false) {
  return selectAudioProviderNodes(nodes, {
    audioPath: "/audio/transcriptions",
    nodeApiType: "audio-transcriptions",
    allowRemote,
  });
}

test("audio node types are eligible on the audio route (the bug)", () => {
  const selected = select([LOCAL_AUDIO_NODE]);
  assert.equal(selected.length, 1, "an audio-transcriptions node must not be filtered out");
  assert.equal(selected[0].id, "localstt");
  assert.equal(selected[0].baseUrl, "http://localhost:9000/v1/audio/transcriptions");
});

test("chat/responses gateways stay eligible (no regression)", () => {
  const selected = select([LOCAL_CHAT_NODE]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, "localchat");
});

test("unrelated node types are never eligible", () => {
  assert.equal(select([LOCAL_EMBEDDINGS_NODE]).length, 0);
});

test("remote nodes are excluded by default (fail-closed egress)", () => {
  assert.equal(select([REMOTE_AUDIO_NODE], false).length, 0);
  // ...and a loopback node alongside it is still selected.
  const mixed = select([REMOTE_AUDIO_NODE, LOCAL_AUDIO_NODE], false);
  assert.deepEqual(
    mixed.map((p) => p.id),
    ["localstt"]
  );
});

test("remote nodes become eligible when explicitly allowed, and carry real credentials", () => {
  const selected = select([REMOTE_AUDIO_NODE], true);
  assert.equal(selected.length, 1);
  const provider = selected[0];
  // Addressed by prefix (what the caller types in `provider/model`)...
  assert.equal(provider.id, "remotestt");
  // ...but credentials resolve under the node id, where connections are stored.
  assert.equal(provider.credentialProviderId, REMOTE_AUDIO_NODE.id);
  // A remote node must present its key — "none" would send an unauthenticated request.
  assert.equal(provider.authType, "apikey");
  assert.equal(provider.authHeader, "bearer");
});

test("loopback nodes keep authType none so local engines need no key", () => {
  const provider = select([LOCAL_AUDIO_NODE])[0];
  assert.equal(provider.authType, "none");
});

test("isLocalAudioNodeHost matches loopback and the Docker private range only", () => {
  assert.equal(isLocalAudioNodeHost("http://localhost:1234"), true);
  assert.equal(isLocalAudioNodeHost("http://127.0.0.1:1234"), true);
  assert.equal(isLocalAudioNodeHost("http://172.17.0.2:1234"), true);
  assert.equal(isLocalAudioNodeHost("http://172.15.0.2:1234"), false);
  assert.equal(isLocalAudioNodeHost("http://172.32.0.2:1234"), false);
  assert.equal(isLocalAudioNodeHost("https://stt.example.com"), false);
  // ::1 stays excluded, matching the previous SSRF hardening.
  assert.equal(isLocalAudioNodeHost("http://[::1]:1234"), false);
  assert.equal(isLocalAudioNodeHost("not-a-url"), false);
});

test("nodes without a baseUrl are skipped instead of throwing", () => {
  const broken = { id: "x", prefix: "x", name: "x", baseUrl: "", apiType: "audio-transcriptions" };
  assert.equal(select([broken as ProviderNodeRow]).length, 0);
});

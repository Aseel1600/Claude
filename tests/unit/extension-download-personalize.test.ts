import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import {
  BASE_URL_SETTING,
  OMNIROUTE_URL_SETTING,
  VSIX_MANIFEST_PATH,
  personalizeManifest,
  personalizeVsix,
  resolveInstanceOrigin,
} from "../../src/app/api/extension/download/personalizeVsix.ts";

/**
 * The extension is downloaded FROM an instance, so it should leave knowing that
 * instance's address. Shipping `http://localhost:20128` made every operator
 * retype the address they had just downloaded from — and on this deployment
 * that default is doubly wrong, since the published port is not even 20128.
 */

const MANIFEST = JSON.stringify({
  name: "ia-one",
  contributes: {
    configuration: {
      title: "OAI Compatible Copilot",
      properties: {
        [OMNIROUTE_URL_SETTING]: { type: "string", default: "http://localhost:20128" },
        [BASE_URL_SETTING]: { type: "string", default: "https://router.huggingface.co/v1" },
        "iaone.omniroute.token": { type: "string", default: "" },
      },
    },
  },
});

function buildVsix(manifest = MANIFEST): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types />"),
    "extension.vsixmanifest": strToU8("<PackageManifest />"),
    [VSIX_MANIFEST_PATH]: strToU8(manifest),
  });
}

function readManifest(archive: Uint8Array) {
  return JSON.parse(strFromU8(unzipSync(archive)[VSIX_MANIFEST_PATH]));
}

test("the packaged defaults point back at the serving instance", () => {
  const out = readManifest(personalizeVsix(buildVsix(), "https://one-ai.example.test"));
  const props = out.contributes.configuration.properties;
  assert.equal(props[OMNIROUTE_URL_SETTING].default, "https://one-ai.example.test");
  assert.equal(props[BASE_URL_SETTING].default, "https://one-ai.example.test/v1");
});

test("the API key stays empty — it is the one thing that cannot be pre-filled", () => {
  const out = readManifest(personalizeVsix(buildVsix(), "https://one-ai.example.test"));
  assert.equal(out.contributes.configuration.properties["iaone.omniroute.token"].default, "");
});

test("a trailing slash never doubles up in the derived URL", () => {
  const out = personalizeManifest(MANIFEST, "https://one-ai.example.test/");
  const props = JSON.parse(out).contributes.configuration.properties;
  assert.equal(props[OMNIROUTE_URL_SETTING].default, "https://one-ai.example.test");
  assert.equal(props[BASE_URL_SETTING].default, "https://one-ai.example.test/v1");
});

test("every other entry of the archive survives untouched", () => {
  const personalized = unzipSync(personalizeVsix(buildVsix(), "https://one-ai.example.test"));
  // A VSIX without these two is not installable.
  assert.equal(strFromU8(personalized["[Content_Types].xml"]), "<Types />");
  assert.equal(strFromU8(personalized["extension.vsixmanifest"]), "<PackageManifest />");
});

test("a configuration declared as an array is handled too", () => {
  const arrayManifest = JSON.stringify({
    contributes: {
      configuration: [
        { properties: { [OMNIROUTE_URL_SETTING]: { default: "http://localhost:20128" } } },
        { properties: { [BASE_URL_SETTING]: { default: "https://router.huggingface.co/v1" } } },
      ],
    },
  });
  const blocks = JSON.parse(personalizeManifest(arrayManifest, "https://x.test")).contributes
    .configuration;
  assert.equal(blocks[0].properties[OMNIROUTE_URL_SETTING].default, "https://x.test");
  assert.equal(blocks[1].properties[BASE_URL_SETTING].default, "https://x.test/v1");
});

test("an unreadable archive is served untouched instead of failing the download", () => {
  // A broken download is worse than a download needing one manual setting.
  const garbage = new Uint8Array([1, 2, 3, 4, 5]);
  assert.deepEqual(personalizeVsix(garbage, "https://x.test"), garbage);
});

test("an archive without a manifest is served untouched", () => {
  const archive = zipSync({ "readme.txt": strToU8("hello") });
  assert.deepEqual(personalizeVsix(archive, "https://x.test"), archive);
});

test("a manifest with no configuration block is left alone", () => {
  const out = personalizeManifest(JSON.stringify({ name: "ia-one" }), "https://x.test");
  assert.deepEqual(JSON.parse(out), { name: "ia-one" });
});

// --- origin resolution -------------------------------------------------------

test("the proxied host wins over the container's internal address", () => {
  // Behind the reverse proxy request.url carries the container host; handing
  // that out would give the operator an address reachable only from Docker.
  const origin = resolveInstanceOrigin(
    new Request("http://omniroute-prod:20128/api/extension/download", {
      headers: {
        host: "omniroute-prod:20128",
        "x-forwarded-host": "one-ai.one1tech.com.br",
        "x-forwarded-proto": "https",
      },
    })
  );
  assert.equal(origin, "https://one-ai.one1tech.com.br");
});

test("only the first hop of a forwarded chain is used", () => {
  const origin = resolveInstanceOrigin(
    new Request("http://internal/api/extension/download", {
      headers: {
        "x-forwarded-host": "one-ai.one1tech.com.br, inner.local",
        "x-forwarded-proto": "https, http",
      },
    })
  );
  assert.equal(origin, "https://one-ai.one1tech.com.br");
});

test("a direct request falls back to its own host", () => {
  const origin = resolveInstanceOrigin(
    new Request("http://localhost:20128/api/extension/download", {
      headers: { host: "localhost:20128" },
    })
  );
  assert.equal(origin, "http://localhost:20128");
});

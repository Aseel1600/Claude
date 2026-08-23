// Guards the changelog FRAGMENTS pipeline (changelog.d/ → CHANGELOG.md), adopted
// 2026-07-09 to kill the CHANGELOG-eat / DIRTY merge-storm cascade: a PR adds ONE new
// file under changelog.d/<section>/ instead of editing CHANGELOG.md, so sibling PRs
// never conflict. Covers the aggregator (scripts/release/aggregate-changelog.mjs) and
// the fragment validation wired into the merge-integrity gate
// (scripts/check/check-changelog-integrity.mjs::findInvalidFragments).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { SECTIONS, validateFragmentText, collectFragments, insertBullets, aggregate, main } =
  await import("../../scripts/release/aggregate-changelog.mjs");
const { findInvalidFragments } = await import("../../scripts/check/check-changelog-integrity.mjs");

const CHANGELOG_FIXTURE = `# Changelog

## [Unreleased]

## [3.8.47] — TBD

_Living section — bullets land here as PRs merge._

### ✨ New Features

- **existing feature**: already here (#1 — thanks @a)

### 🐛 Bug Fixes

- **fix(x):** existing fix (#2 — thanks @b)

### 📝 Maintenance

- chore: existing maintenance (#3)

## [3.8.46] - 2026-07-04

### ✨ New Features

- **old feature**: shipped (#0)
`;

const CHANGELOG_WITH_UNRELEASED_HEADINGS = CHANGELOG_FIXTURE.replace(
  "## [Unreleased]\n",
  `## [Unreleased]

### ✨ New Features

- **unreleased feature**: must stay here (#900)

### 🐛 Bug Fixes

- **unreleased fix**: must stay here (#901)

### 📝 Maintenance

- **unreleased maintenance**: must stay here (#902)
`
);

function makeRoot({ fragments = {}, changelog = CHANGELOG_FIXTURE } = {}) {
  const root = mkdtempSync(join(tmpdir(), "chfrag-"));
  writeFileSync(join(root, "CHANGELOG.md"), changelog);
  mkdirSync(join(root, "changelog.d"), { recursive: true });
  for (const [rel, text] of Object.entries(fragments)) {
    const abs = join(root, "changelog.d", rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, text);
  }
  return root;
}

function makeSink() {
  let value = "";
  return {
    stream: {
      write(chunk) {
        value += String(chunk);
        return true;
      },
    },
    read: () => value,
  };
}

test("validateFragmentText accepts a bullet and rejects garbage", () => {
  assert.equal(validateFragmentText("- **fix:** ok (#9 — thanks @x)"), null);
  assert.equal(validateFragmentText("- multi\n  continuation line"), null);
  assert.match(validateFragmentText(""), /empty/);
  assert.match(validateFragmentText("not a bullet"), /must start/);
  assert.match(validateFragmentText("- ok\n<<<<<<< HEAD"), /conflict markers/);
});

test("validateFragmentText rejects unresolved PR placeholders", () => {
  for (const text of [
    "- fix ([#PRNUM](https://github.com/x/y/pull/10769))",
    "- fix ([#PENDING](https://github.com/x/y/pull/PENDING))",
    "- fix ([#10769](https://github.com/x/y/pull/PENDING))",
  ]) {
    assert.match(validateFragmentText(text), /unresolved PR placeholder/);
  }
});

test("validateFragmentText rejects mismatched OmniRoute pull-link labels", () => {
  for (const text of [
    "- fix ([11050](https://github.com/diegosouzapw/OmniRoute/pull/11050))",
    "- fix ([#11049](https://github.com/diegosouzapw/OmniRoute/pull/11050))",
  ]) {
    assert.match(validateFragmentText(text), /pull link label must be \"#11050\"/);
  }
});

test("collectFragments reads sections sorted and flags invalid files", () => {
  const root = makeRoot({
    fragments: {
      "fixes/6700-b.md": "- fix B (#6700)",
      "fixes/6496-a.md": "- fix A (#6496)",
      "features/6728-chaos.md": "- feat chaos (#6728)",
      "features/bad.md": "no bullet here",
    },
  });
  const c = collectFragments(root);
  assert.deepEqual(
    c.fixes.map((f) => f.text),
    ["- fix A (#6496)", "- fix B (#6700)"]
  );
  assert.equal(c.features.length, 1);
  assert.equal(c.invalid.length, 1);
  assert.match(c.invalid[0].file, /bad\.md/);
  rmSync(root, { recursive: true, force: true });
});

test("insertBullets appends at the END of each living section", () => {
  const out = insertBullets(
    CHANGELOG_FIXTURE,
    {
      features: [{ text: "- NEW feature bullet (#10)" }],
      fixes: [{ text: "- NEW fix bullet (#11)" }],
      maintenance: [{ text: "- NEW maintenance bullet (#12)" }],
    },
    { version: "3.8.47" }
  );
  const lines = out.split("\n");
  const featIdx = lines.indexOf("- NEW feature bullet (#10)");
  const bugHeadIdx = lines.indexOf("### 🐛 Bug Fixes");
  const fixIdx = lines.indexOf("- NEW fix bullet (#11)");
  const maintHeadIdx = lines.indexOf("### 📝 Maintenance");
  const maintIdx = lines.indexOf("- NEW maintenance bullet (#12)");
  // Each new bullet lands after its own existing bullets, before the next heading.
  assert.ok(featIdx > lines.indexOf("- **existing feature**: already here (#1 — thanks @a)"));
  assert.ok(featIdx < bugHeadIdx, "feature bullet must stay inside the features section");
  assert.ok(fixIdx > bugHeadIdx && fixIdx < maintHeadIdx);
  assert.ok(maintIdx > maintHeadIdx && maintIdx < lines.indexOf("## [3.8.46] - 2026-07-04"));
  // Only the requested version is touched — the shipped 3.8.46 section is byte-identical.
  assert.ok(
    out.includes(
      "## [3.8.46] - 2026-07-04\n\n### ✨ New Features\n\n- **old feature**: shipped (#0)"
    )
  );
  // No existing bullet lost.
  for (const existing of ["#1 — thanks @a", "existing fix (#2", "existing maintenance (#3"]) {
    assert.ok(out.includes(existing));
  }
});

test("insertBullets targets the requested version when Unreleased has identical headings", () => {
  const beforeUnreleased = CHANGELOG_WITH_UNRELEASED_HEADINGS.slice(
    CHANGELOG_WITH_UNRELEASED_HEADINGS.indexOf("## [Unreleased]"),
    CHANGELOG_WITH_UNRELEASED_HEADINGS.indexOf("## [3.8.47]")
  );
  const out = insertBullets(
    CHANGELOG_WITH_UNRELEASED_HEADINGS,
    {
      features: [{ text: "- TARGET feature (#10)" }],
      fixes: [{ text: "- TARGET fix (#11)" }],
      maintenance: [{ text: "- TARGET maintenance (#12)" }],
    },
    { version: "3.8.47" }
  );
  const afterUnreleased = out.slice(out.indexOf("## [Unreleased]"), out.indexOf("## [3.8.47]"));
  const target = out.slice(out.indexOf("## [3.8.47]"), out.indexOf("## [3.8.46]"));

  assert.equal(afterUnreleased, beforeUnreleased, "Unreleased must remain byte-identical");
  for (const bullet of ["TARGET feature (#10)", "TARGET fix (#11)", "TARGET maintenance (#12)"]) {
    assert.ok(target.includes(bullet), `${bullet} must land inside [3.8.47]`);
  }
});

test("insertBullets throws when a needed heading is missing", () => {
  const noMaint = CHANGELOG_FIXTURE.replace(
    "### 📝 Maintenance\n\n- chore: existing maintenance (#3)\n",
    ""
  );
  assert.throws(
    () => insertBullets(noMaint, { maintenance: [{ text: "- x" }] }, { version: "3.8.47" }),
    /📝 Maintenance.*not found/s
  );
});

test("aggregate requires an explicit target version before mutating files", () => {
  const root = makeRoot({
    fragments: { "fixes/6800-safe.md": "- safe fix (#6800 — thanks @c)" },
  });
  const before = readFileSync(join(root, "CHANGELOG.md"), "utf8");

  assert.throws(() => aggregate({ root }), /target version is required/);
  assert.equal(readFileSync(join(root, "CHANGELOG.md"), "utf8"), before);
  assert.ok(existsSync(join(root, "changelog.d/fixes/6800-safe.md")));
  rmSync(root, { recursive: true, force: true });
});

test("aggregate fails without mutation when the target version is absent", () => {
  const root = makeRoot({
    fragments: { "fixes/6801-safe.md": "- safe fix (#6801 — thanks @c)" },
  });
  const before = readFileSync(join(root, "CHANGELOG.md"), "utf8");

  assert.throws(
    () => aggregate({ root, version: "9.9.9" }),
    /target version \[9\.9\.9\] not found/
  );
  assert.equal(readFileSync(join(root, "CHANGELOG.md"), "utf8"), before);
  assert.ok(existsSync(join(root, "changelog.d/fixes/6801-safe.md")));
  rmSync(root, { recursive: true, force: true });
});

test("aggregate rejects duplicate target versions and headings before mutation", () => {
  const duplicateVersion = `${CHANGELOG_FIXTURE}\n## [3.8.47] — duplicate\n`;
  const duplicateHeading = CHANGELOG_FIXTURE.replace(
    "### 📝 Maintenance\n\n- chore: existing maintenance (#3)",
    "### 📝 Maintenance\n\n- chore: existing maintenance (#3)\n\n### 📝 Maintenance"
  );

  for (const [changelog, message] of [
    [duplicateVersion, /target version \[3\.8\.47\] appears 2 times/],
    [duplicateHeading, /Maintenance.*appears 2 times/s],
  ]) {
    const root = makeRoot({
      changelog,
      fragments: { "maintenance/6802-safe.md": "- safe maintenance (#6802)" },
    });
    const before = readFileSync(join(root, "CHANGELOG.md"), "utf8");

    assert.throws(() => aggregate({ root, version: "3.8.47" }), message);
    assert.equal(readFileSync(join(root, "CHANGELOG.md"), "utf8"), before);
    assert.ok(existsSync(join(root, "changelog.d/maintenance/6802-safe.md")));
    rmSync(root, { recursive: true, force: true });
  }
});

test("aggregate rejects a fragment already present verbatim in the target version", () => {
  const fragment = "- **fix(x):** existing fix (#2 — thanks @b)";
  const root = makeRoot({ fragments: { "fixes/2-duplicate.md": fragment } });
  const before = readFileSync(join(root, "CHANGELOG.md"), "utf8");

  assert.throws(
    () => aggregate({ root, version: "3.8.47" }),
    /fragment content is already present.*fixes\/2-duplicate\.md/s
  );
  assert.equal(readFileSync(join(root, "CHANGELOG.md"), "utf8"), before);
  assert.ok(existsSync(join(root, "changelog.d/fixes/2-duplicate.md")));
  rmSync(root, { recursive: true, force: true });
});

test("aggregate dry-run touches nothing; real run writes and deletes fragments", () => {
  const root = makeRoot({
    fragments: { "fixes/6800-real.md": "- real aggregated fix (#6800 — thanks @c)" },
  });
  const dry = aggregate({ root, version: "3.8.47", dryRun: true });
  assert.equal(dry.total, 1);
  assert.ok(!readFileSync(join(root, "CHANGELOG.md"), "utf8").includes("#6800"));
  assert.ok(existsSync(join(root, "changelog.d/fixes/6800-real.md")));

  const real = aggregate({ root, version: "3.8.47" });
  assert.equal(real.total, 1);
  const after = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  assert.ok(after.includes("- real aggregated fix (#6800 — thanks @c)"));
  assert.ok(!existsSync(join(root, "changelog.d/fixes/6800-real.md")), "fragment must be deleted");

  // Idempotence: nothing left → second run is a no-op.
  const again = aggregate({ root, version: "3.8.47" });
  assert.equal(again.total, 0);
  assert.equal(readFileSync(join(root, "CHANGELOG.md"), "utf8"), after);
  rmSync(root, { recursive: true, force: true });
});

test("CLI requires --version and dry-run renders the candidate changelog without mutation", () => {
  const root = makeRoot({
    fragments: { "fixes/6803-cli.md": "- CLI-rendered fix (#6803 — thanks @c)" },
  });
  const before = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  const stdout = makeSink();
  const stderr = makeSink();

  assert.equal(
    main(["--version", "3.8.47", "--dry-run"], {
      root,
      stdout: stdout.stream,
      stderr: stderr.stream,
    }),
    0
  );
  assert.ok(stdout.read().includes("- CLI-rendered fix (#6803 — thanks @c)"));
  assert.ok(stdout.read().includes("## [3.8.47] — TBD"));
  assert.ok(!stdout.read().includes("[aggregate-changelog]"), "stdout remains renderable markdown");
  assert.match(stderr.read(), /would aggregate.*fixes\/6803-cli\.md/s);
  assert.equal(readFileSync(join(root, "CHANGELOG.md"), "utf8"), before);
  assert.ok(existsSync(join(root, "changelog.d/fixes/6803-cli.md")));

  const missingVersionError = makeSink();
  assert.equal(
    main(["--dry-run"], {
      root,
      stdout: makeSink().stream,
      stderr: missingVersionError.stream,
    }),
    2
  );
  assert.match(missingVersionError.read(), /--version <version> is required/);
  assert.equal(readFileSync(join(root, "CHANGELOG.md"), "utf8"), before);
  assert.ok(existsSync(join(root, "changelog.d/fixes/6803-cli.md")));
  rmSync(root, { recursive: true, force: true });
});

test("aggregate refuses invalid fragments loudly", () => {
  const root = makeRoot({ fragments: { "features/oops.md": "forgot the dash" } });
  assert.throws(() => aggregate({ root, version: "3.8.47" }), /invalid changelog fragments/);
  rmSync(root, { recursive: true, force: true });
});

test("gate findInvalidFragments: clean tree passes, bad placement/content fail", () => {
  const clean = makeRoot({ fragments: { "maintenance/1-ok.md": "- ok (#1)" } });
  assert.deepEqual(findInvalidFragments(clean), []);
  rmSync(clean, { recursive: true, force: true });

  const dirty = makeRoot({
    fragments: {
      "stray.md": "- misplaced at root",
      "unknown-section/2-x.md": "- wrong dir",
      "fixes/3-bad.md": "missing dash",
    },
  });
  const invalid = findInvalidFragments(dirty);
  const files = invalid.map((i) => i.file).sort();
  assert.equal(invalid.length, 3);
  assert.ok(files.some((f) => f.includes("stray.md")));
  assert.ok(files.some((f) => f.includes("unknown-section")));
  assert.ok(files.some((f) => f.includes("3-bad.md")));
  rmSync(dirty, { recursive: true, force: true });
});

test("gate skips README.md and .gitkeep; absent changelog.d is fine", () => {
  const root = makeRoot();
  writeFileSync(join(root, "changelog.d/README.md"), "# docs, not a fragment");
  mkdirSync(join(root, "changelog.d/fixes"), { recursive: true });
  writeFileSync(join(root, "changelog.d/fixes/.gitkeep"), "");
  assert.deepEqual(findInvalidFragments(root), []);
  rmSync(root, { recursive: true, force: true });

  const bare = mkdtempSync(join(tmpdir(), "chfrag-bare-"));
  assert.deepEqual(findInvalidFragments(bare), []);
  rmSync(bare, { recursive: true, force: true });
});

test("SECTIONS maps every dir to a real living-section heading in the fixture", () => {
  for (const heading of Object.values(SECTIONS)) {
    assert.ok(CHANGELOG_FIXTURE.includes(heading), `fixture must contain ${heading}`);
  }
});

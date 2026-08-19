// tests/unit/build/check-vercel-react-best-practices.test.ts
// Unit tests for scripts/check/check-vercel-react-best-practices.mjs.
//
// Strategy: test the exported pure functions (scanSourceFile, extractElementProps,
// evaluateRatchet) with synthetic fixtures — no filesystem, no baseline file.
import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error — .mjs helper has no type declarations; runtime shape is known.
import {
  scanSourceFile,
  extractElementProps,
  evaluateRatchet,
} from "../../../scripts/check/check-vercel-react-best-practices.mjs";

type Finding = { ruleId: string; file: string; line: number; snippet: string };
const scan = (src: string, name = "fixture.tsx") =>
  scanSourceFile(src, name) as Finding[];

const ruleIds = (src: string) => [...new Set(scan(src).map((f) => f.ruleId))];

// ---------------------------------------------------------------------------
// extractElementProps
// ---------------------------------------------------------------------------

test("extractElementProps captures props across lines and quoted brackets", () => {
  const src = `<div className="a > b" onClick={() => x(">")} data-x="1">`;
  const { end, props } = extractElementProps(src, 0);
  assert.equal(end, src.length - 1);
  assert.match(props, /onClick/);
  assert.match(props, /className="a > b"/);
});

// ---------------------------------------------------------------------------
// transitionAll
// ---------------------------------------------------------------------------

test("flags transition-all Tailwind class", () => {
  assert.deepEqual(ruleIds(`<div className="transition-all duration-300" />`), ["transitionAll"]);
});

test("flags transition: all in CSS", () => {
  const f = scan(`.x { transition: all 0.3s; }`, "fixture.css");
  assert.equal(f[0].ruleId, "transitionAll");
});

test("does not flag explicit transition properties", () => {
  assert.deepEqual(ruleIds(`<div className="transition-transform duration-300" />`), []);
});

// ---------------------------------------------------------------------------
// outlineNoneNoFocus
// ---------------------------------------------------------------------------

test("flags outline-none without focus ring", () => {
  assert.deepEqual(ruleIds(`<input className="outline-none px-2" />`), ["outlineNoneNoFocus"]);
});

test("accepts outline-none paired with focus ring", () => {
  assert.deepEqual(ruleIds(`<input className="outline-none focus-visible:ring-2" />`), []);
});

// ---------------------------------------------------------------------------
// divOnClickNoKeyboard
// ---------------------------------------------------------------------------

test("flags <div onClick> without keyboard access", () => {
  assert.deepEqual(ruleIds(`<div onClick={toggle}>x</div>`), ["divOnClickNoKeyboard"]);
});

test("accepts <div onClick> with role and tabIndex", () => {
  assert.deepEqual(
    ruleIds(`<div role="button" tabIndex={0} onClick={toggle} onKeyDown={onKey}>x</div>`),
    []
  );
});

test("accepts a real <button> (not a div)", () => {
  assert.deepEqual(ruleIds(`<button onClick={toggle}>Save</button>`), []);
});

// ---------------------------------------------------------------------------
// imgMissingAlt / imgMissingDimensions
// ---------------------------------------------------------------------------

test("flags <img> without alt", () => {
  assert.ok(ruleIds(`<img src="/x.png" width={64} height={64} />`).includes("imgMissingAlt"));
});

test("flags <img> with alt but no dimensions", () => {
  assert.ok(ruleIds(`<img src="/x.png" alt="chart" />`).includes("imgMissingDimensions"));
});

test("accepts <img> with alt and dimensions", () => {
  assert.deepEqual(ruleIds(`<img src="/x.png" alt="chart" width={64} height={64} />`), []);
});

// ---------------------------------------------------------------------------
// loadingEllipsis
// ---------------------------------------------------------------------------

test('flags "Loading..." string', () => {
  assert.deepEqual(ruleIds(`<div>{"Loading..."}</div>`), ["loadingEllipsis"]);
});

test('accepts "Loading…" ellipsis character', () => {
  assert.deepEqual(ruleIds(`<div>{"Loading…"}</div>`), []);
});

// ---------------------------------------------------------------------------
// toLocaleUndefined
// ---------------------------------------------------------------------------

test("flags toLocaleString with undefined locale", () => {
  assert.deepEqual(ruleIds(`const s = n.toLocaleString(undefined, { maximumFractionDigits: 0 });`), [
    "toLocaleUndefined",
  ]);
});

test("accepts toLocaleString without args (runtime default)", () => {
  assert.deepEqual(ruleIds(`const s = n.toLocaleString();`), []);
});

// ---------------------------------------------------------------------------
// userScalableNo
// ---------------------------------------------------------------------------

test("flags user-scalable=no in viewport meta", () => {
  assert.deepEqual(ruleIds(`<meta name="viewport" content="user-scalable=no" />`), ["userScalableNo"]);
});

test("flags maximum-scale=1", () => {
  assert.deepEqual(ruleIds(`<meta name="viewport" content="width=device-width, maximum-scale=1" />`), [
    "userScalableNo",
  ]);
});

// ---------------------------------------------------------------------------
// onPastePreventDefault
// ---------------------------------------------------------------------------

test("flags onPaste handler calling preventDefault", () => {
  const src = `<input onPaste={(e) => { e.preventDefault(); parse(e.clipboardData); }} />`;
  assert.deepEqual(ruleIds(src), ["onPastePreventDefault"]);
});

test("accepts onPaste that does not preventDefault", () => {
  const src = `<input onPaste={(e) => { const t = e.clipboardData.getData("text"); }} />`;
  assert.deepEqual(ruleIds(src), []);
});

// ---------------------------------------------------------------------------
// noReducedMotionFile
// ---------------------------------------------------------------------------

test("flags animation file without prefers-reduced-motion", () => {
  const f = scan(`.blob { animation: blob 20s infinite; }`, "fixture.css");
  assert.equal(f[0].ruleId, "noReducedMotionFile");
});

test("accepts animation file with prefers-reduced-motion", () => {
  const src = `@keyframes blob {} @media (prefers-reduced-motion: reduce) { .blob { animation: none; } }`;
  assert.deepEqual(ruleIds(src), []);
});

// ---------------------------------------------------------------------------
// iconButtonNoLabel
// ---------------------------------------------------------------------------

test("flags icon-only button without aria-label", () => {
  const src = `<button onClick={onMenu}>\n  <span className="material-symbols-outlined">menu</span>\n</button>`;
  assert.deepEqual(ruleIds(src), ["iconButtonNoLabel"]);
});

test("accepts icon button with aria-label", () => {
  const src = `<button aria-label="Open menu" onClick={onMenu}>\n  <span className="material-symbols-outlined">menu</span>\n</button>`;
  assert.deepEqual(ruleIds(src), []);
});

test("accepts button with text label and icon", () => {
  const src = `<button onClick={save}>\n  <span className="material-symbols-outlined">save</span> Save\n</button>`;
  assert.deepEqual(ruleIds(src), []);
});

test("accepts button whose text label lives in a separate span", () => {
  // Regressione: remover TODOS os spans apagava também o texto do label —
  // só os spans de ícone (material-symbols-outlined) podem ser descartados.
  const src = `<button type="button" onClick={f}>\n  <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>\n  <span>{tab.label}</span>\n</button>`;
  assert.deepEqual(ruleIds(src), []);
});

// ---------------------------------------------------------------------------
// evaluateRatchet
// ---------------------------------------------------------------------------

test("evaluateRatchet: measured > baseline is a regression", () => {
  assert.equal(evaluateRatchet(12, 11).regressed, true);
  assert.equal(evaluateRatchet(12, 11).improved, false);
});

test("evaluateRatchet: measured < baseline is an improvement", () => {
  assert.equal(evaluateRatchet(10, 11).improved, true);
});

test("evaluateRatchet: equal is neutral", () => {
  assert.equal(evaluateRatchet(11, 11).regressed, false);
});

// ---------------------------------------------------------------------------
// scanSourceFile ignores non-UI files
// ---------------------------------------------------------------------------

test("non-tsx/css/ts files produce no findings", () => {
  assert.deepEqual(scan(`<div onClick={x}>`, "fixture.json"), []);
});

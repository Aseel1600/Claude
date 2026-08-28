// Issue #11766: classifyReadiness is an exported test seam guarding contract C4:
// ready > hanging > fast-reject > not-listening. Reversing that precedence can
// reintroduce #6800 by declaring a never-answering server ready.

import test from "node:test";
import assert from "node:assert/strict";

import { classifyReadiness } from "../../bin/cli/utils/pid.mjs";

const PRECEDENCE = ["ready", "hanging", "fast-reject", "not-listening"];
const REQUIRED_CASES = [
  { outcomes: ["hanging", "fast-reject"], expected: "hanging" },
  { outcomes: ["fast-reject", "not-listening"], expected: "fast-reject" },
  { outcomes: ["ready", "hanging"], expected: "ready" },
  { outcomes: ["not-listening", "not-listening"], expected: "not-listening" },
];

test("#11766: required readiness cases are independent of probe completion order", () => {
  for (const { outcomes, expected } of REQUIRED_CASES) {
    assert.equal(
      classifyReadiness(outcomes),
      expected,
      `${outcomes.join(" + ")} should classify as ${expected}`
    );
    assert.equal(
      classifyReadiness([...outcomes].reverse()),
      expected,
      `${[...outcomes].reverse().join(" + ")} should classify as ${expected}`
    );
  }
});

test("#11766: full ordered-pair table follows the frozen readiness precedence", () => {
  for (const left of PRECEDENCE) {
    for (const right of PRECEDENCE) {
      const expected = PRECEDENCE[Math.min(PRECEDENCE.indexOf(left), PRECEDENCE.indexOf(right))];
      assert.equal(
        classifyReadiness([left, right]),
        expected,
        `${left} + ${right} should classify as ${expected}`
      );
    }
  }
});

test("#11766: each adjacent rung wins over the next rung in both orders", () => {
  for (let index = 0; index < PRECEDENCE.length - 1; index += 1) {
    const higher = PRECEDENCE[index];
    const lower = PRECEDENCE[index + 1];
    for (const outcomes of [
      [higher, lower],
      [lower, higher],
    ]) {
      assert.equal(
        classifyReadiness(outcomes),
        higher,
        `${outcomes.join(" + ")} should preserve the ${higher} > ${lower} rung`
      );
    }
  }
});

test("#11766: the fallback rung handles empty and single-outcome inputs", () => {
  assert.equal(classifyReadiness([]), "not-listening");
  assert.equal(classifyReadiness(["hanging"]), "hanging");
});

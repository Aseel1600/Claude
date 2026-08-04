// #9140 — VS Code routes filter out built-in auto models
import test from "node:test";
import assert from "node:assert/strict";

const { isUsableChatModel } = await import(
	"../../src/app/api/v1/vscode/[token]/usableChatModel.ts"
);

test("#9140 VS Code listing must accept built-in auto routing entries", () => {
	assert.equal(
		isUsableChatModel({ id: "auto/best-coding", owned_by: "combo" }),
		true,
		"built-in auto/* model should be accepted"
	);
	assert.equal(
		isUsableChatModel({ id: "operator-combo", owned_by: "combo" }),
		false,
		"operator-created combo should still be rejected"
	);
});
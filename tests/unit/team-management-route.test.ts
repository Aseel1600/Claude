import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const paths = [
  "src/app/api/teams/route.ts",
  "src/app/api/teams/[id]/route.ts",
  "src/app/api/teams/[id]/members/route.ts",
  "src/app/api/teams/[id]/usage/route.ts",
];

for (const relativePath of paths) {
  test(`${relativePath} is management-authenticated and sanitizes errors`, () => {
    const source = readFileSync(join(ROOT, relativePath), "utf8");
    assert.match(source, /requireManagementAuth/);
    assert.match(source, /if \(authError\) return authError/);
    assert.match(source, /buildErrorBody/);
    assert.doesNotMatch(source, /err\.stack|error\.stack/);
  });
}

test("team routes validate mutations and expose CRUD, assignment, and usage operations", () => {
  const list = readFileSync(join(ROOT, paths[0]), "utf8");
  const detail = readFileSync(join(ROOT, paths[1]), "utf8");
  const members = readFileSync(join(ROOT, paths[2]), "utf8");
  const usage = readFileSync(join(ROOT, paths[3]), "utf8");
  assert.match(list, /TeamCreateSchema/);
  assert.match(detail, /TeamUpdateSchema/);
  assert.match(members, /TeamMemberAssignmentSchema/);
  assert.match(list, /export async function GET/);
  assert.match(list, /export async function POST/);
  assert.match(detail, /export async function GET/);
  assert.match(detail, /export async function PATCH/);
  assert.match(detail, /export async function DELETE/);
  assert.match(members, /export async function GET/);
  assert.match(members, /export async function PUT/);
  assert.match(members, /export async function DELETE/);
  assert.match(usage, /getTeamUsageReport/);
});

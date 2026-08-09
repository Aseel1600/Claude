import test from 'node:test';
import assert from 'node:assert/strict';
const runway = require('../../lib/runway-mock');

test('runway mock create/get/set status', async (t) => {
  const job = await runway.createJob({ prompt: 'hello' });
  assert(job && job.id, 'job created');
  const status1 = await runway.getStatus(job.id);
  assert.equal(status1.status, 'queued');
  await runway.setStatus(job.id, 'rendering');
  const status2 = await runway.getStatus(job.id);
  assert.equal(status2.status, 'rendering');
});

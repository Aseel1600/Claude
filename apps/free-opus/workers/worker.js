// Simple worker script for demo: poll the in-memory queue and "render" jobs.
const queue = require("../lib/queue");
const runway = require("../lib/runway-mock");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  console.log("Worker started (demo in-memory). Polling queue...");
  while (true) {
    const item = queue.dequeue();
    if (!item) {
      await sleep(2000);
      continue;
    }

    console.log(`Processing job ${item.id}`);
    try {
      // Simulate render time and progress updates
      await sleep(3000);
      // Mark runway mock as rendering
      await runway.setStatus(item.id, "rendering");
      await sleep(3000);
      // On success write a fake result URL
      queue.complete(item.id, { url: `https://mock-storage.local/video/${item.id}.mp4` });
      console.log(`Job ${item.id} complete`);
    } catch (err) {
      console.error(`Job ${item.id} failed`, err);
      queue.fail(item.id, err);
    }
  }
}

if (require.main === module) run().catch(err => { console.error(err); process.exit(1); });

module.exports = { run };

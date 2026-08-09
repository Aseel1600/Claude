// Simple worker script for demo: poll the in-memory queue and "render" jobs.
const queue = require("../lib/queue");
const runway = require("../lib/runway-mock");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  console.log("Worker started (demo). Polling queue with retry/backoff...");
  const MAX_ATTEMPTS = Number(process.env.WORKER_MAX_ATTEMPTS || 3);
  const BASE_DELAY_MS = Number(process.env.WORKER_BASE_DELAY_MS || 2000);

  while (true) {
    const item = await queue.dequeue();
    if (!item) {
      await sleep(1000);
      continue;
    }

    const jobId = item.id || item.job?.id;
    console.log(`Processing job ${jobId}`);
    try {
      // Update runway status to rendering
      await runway.setStatus(jobId, "rendering");

      // Simulate render work (could call providers.runway here)
      await sleep(3000);

      // Simulate possible transient failure
      if (Math.random() < 0.1) throw new Error("transient_render_error");

      // On success write a fake result URL
      const result = { url: `https://mock-storage.local/video/${jobId}.mp4` };
      await queue.complete(jobId, result);
      console.log(`Job ${jobId} complete`);
    } catch (err) {
      console.error(`Job ${jobId} failed`, err.message || err);
      // Attempt retry/backoff if attempts available
      try {
        const status = await queue.getStatus(jobId) || {};
        const attempts = Number(status.attempts || 0) + 1;
        await queue.fail(jobId, err);
        if (attempts < MAX_ATTEMPTS) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempts - 1);
          console.log(`Re-enqueueing job ${jobId} for retry #${attempts} after ${delay}ms`);
          // simple delay using setTimeout then re-enqueue (for in-memory); for Redis we'd use delayed queue or scheduler
          setTimeout(async () => {
            try {
              await queue.enqueue({ id: jobId, prompt: item.job?.prompt || item.prompt });
              const meta = await queue.getStatus(jobId);
              if (meta) meta.attempts = attempts;
            } catch (e) { console.error('re-enqueue failed', e); }
          }, delay);
        } else {
          console.log(`Job ${jobId} reached max attempts (${MAX_ATTEMPTS}) and is marked failed.`);
        }
      } catch (e) { console.error('retry handling failed', e); }
    }
  }
}

if (require.main === module) run().catch(err => { console.error(err); process.exit(1); });

module.exports = { run };

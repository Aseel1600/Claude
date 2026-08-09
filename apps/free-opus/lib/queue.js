// Queue wrapper: select Redis-backed queue when REDIS_URL is provided, else fall back to in-memory.
let queueImpl = null;

if (process.env.REDIS_URL) {
  try {
    const RedisQueue = require("./queue-redis");
    const redisQueue = new RedisQueue();
    queueImpl = {
      enqueue: (job) => redisQueue.enqueue(job),
      dequeue: () => redisQueue.dequeue(),
      complete: (id, result) => redisQueue.complete(id, result),
      fail: (id, err) => redisQueue.fail(id, err),
      getStatus: (id) => redisQueue.getStatus(id)
    };
  } catch (err) {
    console.warn("REDIS_URL set but queue-redis load failed:", err.message);
  }
}

if (!queueImpl) {
  // Simple in-memory queue for demo. NOT durable — replace with Redis/queue in prod.
  const runway = require("./runway-mock");

  const q = [];
  const byId = new Map();

  function enqueue(job) {
    const id = job.id || require("uuid").v4();
    job.id = id;
    const item = { id: job.id, job, enqueuedAt: Date.now(), attempts: 0 };
    q.push(item);
    byId.set(job.id, { status: "queued", enqueuedAt: item.enqueuedAt });
    return item;
  }

  function dequeue() {
    const item = q.shift();
    if (!item) return null;
    byId.set(item.id, { status: "processing", startedAt: Date.now() });
    return item;
  }

  function complete(id, result) {
    byId.set(id, { status: "complete", result, completedAt: Date.now() });
    // also update runway mock
    runway.setStatus(id, "complete", { url: `https://mock-storage.local/video/${id}.mp4` }).catch(() => {});
  }

  function fail(id, err) {
    byId.set(id, { status: "failed", error: String(err), at: Date.now() });
  }

  function getStatus(id) {
    return byId.get(id) || null;
  }

  queueImpl = { enqueue, dequeue, complete, fail, getStatus };
}

module.exports = queueImpl;

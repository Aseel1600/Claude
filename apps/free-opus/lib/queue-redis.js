// Redis-backed queue implementation (requires ioredis)
// Uses a list key 'free-opus:jobs' to push job JSON strings.
// NOTE: This file is optional and used when REDIS_URL is provided.

const IORedis = require("ioredis");
const { v4: uuidv4 } = require("uuid");

class RedisQueue {
  constructor() {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL not set");
    this.redis = new IORedis(url);
    this.listKey = process.env.REDIS_QUEUE_KEY || "free-opus:jobs";
  }

  async enqueue(job) {
    // ensure job has id
    if (!job.id) job.id = uuidv4();
    await this.redis.lpush(this.listKey, JSON.stringify(job));
    await this.redis.hset(`free-opus:job:${job.id}`, "status", "queued", "createdAt", Date.now());
    return job;
  }

  async dequeue() {
    // BRPOP with timeout 1 second
    const res = await this.redis.brpop(this.listKey, 1);
    if (!res) return null;
    const payload = res[1];
    const job = JSON.parse(payload);
    await this.redis.hset(`free-opus:job:${job.id}`, "status", "processing", "startedAt", Date.now());
    return { id: job.id, job };
  }

  async complete(id, result) {
    await this.redis.hset(`free-opus:job:${id}`, "status", "complete", "completedAt", Date.now());
    if (result) await this.redis.hset(`free-opus:job:${id}`, "result", JSON.stringify(result));
  }

  async fail(id, err) {
    await this.redis.hset(`free-opus:job:${id}`, "status", "failed", "error", String(err), "failedAt", Date.now());
  }

  async getStatus(id) {
    const h = await this.redis.hgetall(`free-opus:job:${id}`);
    if (!h || Object.keys(h).length === 0) return null;
    if (h.result) try { h.result = JSON.parse(h.result); } catch (e) {}
    return h;
  }
}

module.exports = RedisQueue;

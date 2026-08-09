// Mock Runway adapter for demoing video render jobs
const { v4: uuidv4 } = require("uuid");

const jobs = new Map();

async function createJob({ prompt }) {
  const id = uuidv4();
  const job = { id, prompt, status: "created", createdAt: Date.now() };
  jobs.set(id, job);
  // Simulate queued state
  job.status = "queued";
  return job;
}

async function getStatus(id) {
  const job = jobs.get(id);
  if (!job) throw new Error("not_found");
  return job;
}

// For worker to mark complete
async function setStatus(id, status, result) {
  const job = jobs.get(id);
  if (!job) throw new Error("not_found");
  job.status = status;
  if (result) job.result = result;
  job.updatedAt = Date.now();
  return job;
}

module.exports = { createJob, getStatus, setStatus, _jobs: jobs };

// Minimal storage helpers (S3-compatible). For demo, returns mock signed URLs.
async function getSignedUploadUrl(key) {
  // TODO: integrate with S3 SDK and return a real presigned URL
  return { url: `https://mock-storage.local/upload/${encodeURIComponent(key)}`, method: "PUT" };
}

async function getSignedDownloadUrl(key) {
  return { url: `https://mock-storage.local/download/${encodeURIComponent(key)}`, method: "GET" };
}

module.exports = { getSignedUploadUrl, getSignedDownloadUrl };

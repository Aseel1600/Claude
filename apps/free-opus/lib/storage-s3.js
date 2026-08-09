// Optional S3 adapter using AWS SDK v3 for presigned URLs.
// If STORAGE_S3_ENDPOINT/KEY/SECRET not set, fall back to mock signed URLs.

let s3Client = null;
let presign = null;
try {
  const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
  const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
  if (process.env.STORAGE_S3_ENDPOINT && process.env.STORAGE_S3_KEY && process.env.STORAGE_S3_SECRET) {
    s3Client = new S3Client({
      endpoint: process.env.STORAGE_S3_ENDPOINT,
      region: process.env.STORAGE_S3_REGION || "us-east-1",
      credentials: { accessKeyId: process.env.STORAGE_S3_KEY, secretAccessKey: process.env.STORAGE_S3_SECRET }
    });
    presign = async (cmd) => getSignedUrl(s3Client, cmd, { expiresIn: 3600 });
  }
} catch (e) {
  // aws sdk not installed; mock fallback
}

async function getSignedUploadUrl(key) {
  if (presign) {
    const { PutObjectCommand } = require("@aws-sdk/client-s3");
    const cmd = new PutObjectCommand({ Bucket: process.env.STORAGE_S3_BUCKET, Key: key });
    return { url: await presign(cmd), method: "PUT" };
  }
  return { url: `https://mock-storage.local/upload/${encodeURIComponent(key)}`, method: "PUT" };
}

async function getSignedDownloadUrl(key) {
  if (presign) {
    const { GetObjectCommand } = require("@aws-sdk/client-s3");
    const cmd = new GetObjectCommand({ Bucket: process.env.STORAGE_S3_BUCKET, Key: key });
    return { url: await presign(cmd), method: "GET" };
  }
  return { url: `https://mock-storage.local/download/${encodeURIComponent(key)}`, method: "GET" };
}

module.exports = { getSignedUploadUrl, getSignedDownloadUrl };

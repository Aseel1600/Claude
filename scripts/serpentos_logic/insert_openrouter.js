import { getDbInstance } from "../../src/lib/db/core.js";
import { randomUUID } from "crypto";
import { encryptConnectionFields } from "../../src/lib/db/encryption.js";

const db = getDbInstance();
const token = process.env.OPENROUTER_API_KEY;

if (token) {
  const fields = encryptConnectionFields({ key: token });
  const stmt = db.prepare(`
      INSERT INTO provider_connections 
      (id, provider_id, account_id, name, connection_fields, encrypted_credentials, credentials_iv, credentials_tag, is_active, created_at, updated_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);

  stmt.run(
    randomUUID(),
    "openrouter",
    "system_account",
    "doppler_openrouter",
    "{}",
    fields.encryptedData,
    fields.iv,
    fields.authTag
  );
  console.log("Added openrouter credentials successfully.");
} else {
  console.log("No OPENROUTER_API_KEY provided.");
}

const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

async function run() {
  const hash = await bcrypt.hash("admin123", 12);
  const db = new Database("/Users/work/hermes-sandbox/storage.sqlite");
  db.prepare("UPDATE key_value SET value = ? WHERE key = 'password'").run(JSON.stringify(hash));
  console.log("Password reset to admin123");
}
run();

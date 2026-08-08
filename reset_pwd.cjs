const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

async function run() {
  const hash = await bcrypt.hash('6666', 12);
  const db = new Database('/Users/work/.omniroute/settings.db');
  db.prepare("UPDATE key_value SET value = ? WHERE key = 'password'").run(JSON.stringify(hash));
  console.log("Password reset to 6666");
}
run().catch(console.error);

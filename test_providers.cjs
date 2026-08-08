const Database = require('better-sqlite3');
const db = new Database('/Users/work/.omniroute/settings.db');

// First activate all
db.prepare("UPDATE provider_connections SET active = 1").run();
console.log("Enabled all providers.");

// Next fetch all providers
const rows = db.prepare("SELECT id, name FROM provider_connections WHERE active = 1").all();
console.log(`Found ${rows.length} active providers.`);

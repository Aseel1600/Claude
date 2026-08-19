const Database = require('better-sqlite3');
const db = new Database('/tmp/storage.sqlite');

// List tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;").all();
console.log("=== Tables ===");
tables.forEach(t => console.log(t.name));

// Look for active synced models
const modelTables = tables.filter(t => t.name.toLowerCase().includes('sync') || t.name.toLowerCase().includes('model') || t.name.toLowerCase().includes('catalog') || t.name.toLowerCase().includes('available'));
console.log("\n=== Model/Sync related tables ===");
modelTables.forEach(t => console.log(t.name));

db.close();

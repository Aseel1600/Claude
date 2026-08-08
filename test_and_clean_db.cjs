const Database = require('better-sqlite3');
const db = new Database('/Users/work/hermes-sandbox/storage.sqlite');

try {
  const combos = db.prepare('SELECT id, name FROM combos').all();
  console.log(`Found ${combos.length} combos.`);
  const models = db.prepare('SELECT id, model FROM models').all();
  console.log(`Found ${models.length} models.`);
} catch (e) {
  console.error("Error reading db:", e.message);
}

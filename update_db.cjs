const Database = require('better-sqlite3');
const db = new Database('/Users/work/hermes-sandbox/storage.sqlite');

// Add Antigravity connection if missing
const checkAg = db.prepare('SELECT id FROM provider_connections WHERE provider = ?').get('antigravity');
let agId = checkAg ? checkAg.id : 'b9f949c2-555e-4c0a-912b-232a9e223d6a';

if (!checkAg) {
  db.prepare(`
    INSERT INTO provider_connections 
    (id, provider, name, is_active, api_key, created_at, updated_at, proxy_enabled) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(agId, 'antigravity', 'Antigravity (Doppler)', 1, 'sk-7c0ce1a7439b45c4bb593c416fbf78f0', new Date().toISOString(), new Date().toISOString(), 1);
  console.log('Added Antigravity connection');
}

// Add opencode zen & antigravity to free-all combo
const combo = db.prepare('SELECT data FROM combos WHERE name = ?').get('free-all');
if (combo) {
  let data = JSON.parse(combo.data);
  let updated = false;
  
  const ocModelId = 'free-all-model-opencode-zen';
  if (!data.models.find(m => m.id === ocModelId)) {
    data.models.push({
      id: ocModelId,
      kind: 'model',
      model: 'deepseek-v4-flash-free',
      providerId: 'openai',
      connectionId: 'f5a68802-2c3f-49fb-a554-8ea2dbed84c4',
      weight: 0
    });
    updated = true;
  }
  
  const agModelId = 'free-all-model-ag-gemini';
  if (!data.models.find(m => m.id === agModelId)) {
    data.models.push({
      id: agModelId,
      kind: 'model',
      model: 'gemini-2.5-flash',
      providerId: 'antigravity',
      connectionId: agId,
      weight: 0
    });
    updated = true;
  }
  
  if (updated) {
    db.prepare('UPDATE combos SET data = ?, updated_at = ? WHERE name = ?')
      .run(JSON.stringify(data), new Date().toISOString(), 'free-all');
    console.log('Updated free-all combo');
  } else {
    console.log('Combo already up to date');
  }
}
db.close();

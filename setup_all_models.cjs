const Database = require('better-sqlite3');
const db = new Database('/Users/work/hermes-sandbox/storage.sqlite');

function updateCombo(name, newModel) {
  const comboRow = db.prepare('SELECT data FROM combos WHERE name = ?').get(name);
  if (comboRow) {
    let data = JSON.parse(comboRow.data);
    let updated = false;
    
    if (!data.models.find(m => m.id === newModel.id)) {
      // Add as primary (first element)
      data.models.unshift(newModel);
      updated = true;
    }
    
    if (updated) {
      db.prepare('UPDATE combos SET data = ?, updated_at = ? WHERE name = ?')
        .run(JSON.stringify(data), new Date().toISOString(), name);
      console.log(`Updated combo: ${name}`);
    }
  }
}

// 1. deepseek-stack -> Add opencode zen
updateCombo('deepseek-stack', {
  id: 'ds-opencode-zen',
  kind: 'model',
  model: 'deepseek-v4-flash-free',
  providerId: 'openai',
  connectionId: 'f5a68802-2c3f-49fb-a554-8ea2dbed84c4',
  weight: 0
});

// 2. gemini-stack -> Add antigravity gemini
const agId = db.prepare('SELECT id FROM provider_connections WHERE provider = ?').get('antigravity')?.id;
if (agId) {
  updateCombo('gemini-stack', {
    id: 'gemini-ag-fallback',
    kind: 'model',
    model: 'gemini-2.5-flash',
    providerId: 'antigravity',
    connectionId: agId,
    weight: 0
  });
}

// 3. coding-stack -> Add opencode zen
updateCombo('coding-stack', {
  id: 'cs-opencode-zen',
  kind: 'model',
  model: 'deepseek-v4-flash-free',
  providerId: 'openai',
  connectionId: 'f5a68802-2c3f-49fb-a554-8ea2dbed84c4',
  weight: 0
});

console.log('All combos configured successfully.');
db.close();

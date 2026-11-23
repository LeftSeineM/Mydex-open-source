// Read-only verification with the existing encrypted local profile. Never prints a key.
const { app } = require('electron');
const path = require('path');
app.setPath('userData', path.join(app.getPath('appData'), 'My Harness'));
for (const stream of [process.stdout, process.stderr]) stream.on('error', () => {});
app.whenReady().then(async () => {
  try {
    const { SettingsStore } = require('../dist/settingsStore');
    const { listApiModels } = require('../dist/apiModels');
    const store = new SettingsStore();
    const settings = await store.load();
    if (settings.apiBaseUrl !== 'http://127.0.0.1:18080/v1') throw new Error('Unexpected relay endpoint; refusing to request');
    const models = await listApiModels(settings.apiBaseUrl, await store.readApiKey());
    console.log(JSON.stringify({ ok: true, count: models.length, selectedModelListed: models.includes(settings.model) }));
    app.exit(0);
  } catch { console.error('Live model discovery failed; no credentials logged.'); app.exit(1); }
});

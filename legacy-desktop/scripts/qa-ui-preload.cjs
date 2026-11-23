const { contextBridge, ipcRenderer } = require('electron');
let listener;
const api = {};
api.referenceFolder = directory => ipcRenderer.invoke('qa', 'referenceFolder', [directory]);
for (const method of ['getPermissions','setPermissions','grantPermissions','getState','listModels','revealFile','updateSettings','chooseWorkspace','restartAgent','listThreads','newThread','resumeThread','startTurn','interruptTurn','manageThread','listDirectory','readFile','openFile','gitStatus','openWorkspace','exportTask','runCommand','stopCommand','approve','answer','menu']) api[method] = (...args) => ipcRenderer.invoke('qa', method, args);
api.onEvent = callback => { listener = callback; return () => { listener = undefined; }; };
ipcRenderer.on('qa-event', (_, channel, payload) => listener?.({ channel, payload }));
contextBridge.exposeInMainWorld('myHarness', api);

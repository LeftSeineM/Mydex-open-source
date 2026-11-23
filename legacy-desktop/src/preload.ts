import { contextBridge, ipcRenderer } from 'electron';

const invoke = (channel: string, payload?: unknown): Promise<unknown> => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('myHarness', {
  getState: () => invoke('app:get-state'),
  listModels: (profileId?: string) => invoke('app:list-models', profileId),
  saveProfile: (profile: unknown) => invoke('app:save-profile', profile),
  activateProfile: (id: string) => invoke('app:activate-profile', id),
  deleteProfile: (id: string) => invoke('app:delete-profile', id),
  revealFile: (filePath: string) => invoke('fs:reveal', { filePath }),
  referenceFolder: (directory?: string) => invoke('fs:reference-folder', { directory }),
  chooseWorkspace: () => invoke('app:choose-workspace'),
  updateSettings: (patch: unknown) => invoke('app:update-settings', patch),
  menu: (name: string) => invoke('app:menu', name),
  restartAgent: () => invoke('agent:restart'),
  listThreads: () => invoke('agent:list-threads'),
  manageThread: (action: string, threadId: string, name?: string) => invoke('agent:manage-thread', { action, threadId, name }),
  gitStatus: () => invoke('workspace:git'),
  openWorkspace: () => invoke('workspace:open'),
  exportTask: (title: string, content: string) => invoke('workspace:export', { title, content }),
  runCommand: (command: string) => invoke('workspace:command', { command }),
  stopCommand: () => invoke('workspace:stop-command'),
  newThread: (key?: string) => invoke('agent:new-thread', { key }),
  getPermissions: (key: string) => invoke('agent:get-permissions', { key }),
  sandboxStatus: () => invoke('agent:sandbox-status'),
  setupSandbox: () => invoke('agent:setup-sandbox'),
  setPermissions: (key: string, mode: string) => invoke('agent:set-permissions', { key, mode }),
  grantPermissions: (requestId: number | string, allow: boolean, scope: string) => invoke('agent:grant-permissions', { requestId, allow, scope }),
  resumeThread: (threadId: string) => invoke('agent:resume-thread', { threadId }),
  startTurn: (threadId: string, prompt: string, folderReferences?: unknown) => invoke('agent:start-turn', { threadId, prompt, folderReferences }),
  interruptTurn: (threadId: string, turnId: string) => invoke('agent:interrupt', { threadId, turnId }),
  approve: (requestId: number | string, decision: string) => invoke('agent:approve', { requestId, decision }),
  answer: (requestId: number | string, answers: unknown) => invoke('agent:answer', { requestId, answers }),
  listDirectory: (directory?: string) => invoke('fs:list', { directory }),
  readFile: (filePath: string) => invoke('fs:read', { filePath }),
  openFile: (filePath: string) => invoke('fs:open', { filePath }),
  onEvent: (listener: (event: { channel: string; payload: unknown }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, channel: string, payload: unknown) => listener({ channel, payload });
    ipcRenderer.on('myharness:event', handler);
    return () => ipcRenderer.removeListener('myharness:event', handler);
  }
});

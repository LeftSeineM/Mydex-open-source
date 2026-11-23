import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, shell, Tray } from 'electron';
import { promises as fs } from 'fs';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import path from 'path';
import { MydexAppServer, validateExecutable } from './mydexAppServer';
import { SettingsStore, ProfileInput } from './settingsStore';
import { AgentSettings, JsonRpcId, ServerRequest } from './types';
import { registerWorkspaceTools } from './workspaceTools';
import { listApiModels } from './apiModels';
import { referenceFolder, prepareFolderPrompt } from './folderReferences';
import { ApprovalRequests, PermissionStore, PERMISSION_MODES } from './permissions';
app.setName('Mydex');
if (process.env.MY_HARNESS_SCREENSHOT)
    app.disableHardwareAcceleration();
if (process.env.MY_HARNESS_DATA_DIR) app.setPath('userData', path.resolve(process.env.MY_HARNESS_DATA_DIR));
else if (process.platform === 'win32') {
    const destination = 'D:/Software/MyHarnessData/desktop';
    const previous = path.join(app.getPath('appData'), 'My Harness');
    mkdirSync(destination, { recursive: true });
    if (!existsSync(path.join(destination, 'settings.json')) && existsSync(path.join(previous, 'settings.json'))) {
        const backup = path.join(destination, 'before-multi-api-migration');
        mkdirSync(backup, { recursive: true });
        for (const file of ['api-key.enc', 'thread-permissions.json', 'settings.json']) if (existsSync(path.join(previous, file))) {
            copyFileSync(path.join(previous, file), path.join(backup, file));
            copyFileSync(path.join(previous, file), path.join(destination, file));
        }
    }
    app.setPath('userData', destination);
}
for (const stream of [process.stdout, process.stderr])
    stream?.on('error', (error: NodeJS.ErrnoException) => {
        if (!['EPIPE', 'ERR_STREAM_DESTROYED'].includes(error.code || ''))
            void fs.appendFile(path.join(app.getPath('userData'), 'io-errors.log'), error.message + '\n').catch(() => { });
    });
let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
function showMainWindow(): void {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show(); mainWindow.focus();
}
function createTray(): void {
    if (tray || process.env.MY_HARNESS_SCREENSHOT) return;
    const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')).resize({ width: 20, height: 20 });
    tray = new Tray(icon);
    tray.setToolTip('Mydex · 多 API 工作台');
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: '打开 Mydex', click: showMainWindow },
        { label: 'API 配置管理…', click: () => { showMainWindow(); sendEvent('menu', 'settings'); } },
        { type: 'separator' },
        { label: '打开安装目录', click: () => { void shell.openPath(process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath)); } },
        { label: '打开配置目录', click: () => { void shell.openPath(app.getPath('userData')); } },
        { type: 'separator' },
        { label: '完全退出 Mydex', click: () => { app.quit(); } }
    ]));
    tray.on('click', showMainWindow); tray.on('double-click', showMainWindow);
}
const settingsStore = new SettingsStore();
const permissions = new PermissionStore(path.join(app.getPath('userData'), 'thread-permissions.json'));
const approvalRequests = new ApprovalRequests();
const changingPermissions = new Set<string>();
const mydex = new MydexAppServer(() => settingsStore.get(), () => settingsStore.readApiKey());
const threadWorkspaces = new Map<string, string>();
const activeTurns = new Map<string, string>();
let sandboxSetupRunning = false;
let connectionChanging = false;
function assertEngineIdle(): void { if (activeTurns.size || sandboxSetupRunning || connectionChanging) throw new Error('仍有对话或沙箱设置运行中，请先等待完成再重启引擎或修改连接配置'); }
async function changeConnection(change: () => Promise<AgentSettings>): Promise<unknown> {
    assertEngineIdle(); connectionChanging = true;
    try {
        const settings = await change();
        sendEvent('settings', settings);
        await mydex.restart();
        return { settings, agentState: await mydex.initializeState() };
    } finally { connectionChanging = false; }
}
function sendEvent(channel: string, payload: unknown): void { if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('myharness:event', channel, payload); }
async function createWindow(): Promise<void> {
    nativeTheme.themeSource = (await settingsStore.load()).theme;
    await permissions.load();
    mainWindow = new BrowserWindow({
        width: 1600, height: 1000, minWidth: 1040, minHeight: 680, show: false, backgroundColor: '#f4f4f4',
        icon: path.join(__dirname, '..', 'assets', 'icon.png'), title: 'Mydex', titleBarStyle: 'hidden',
        titleBarOverlay: { color: '#f4f4f4', symbolColor: '#666666', height: 34 },
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false }
    });
    const syncTheme = () => mainWindow?.setTitleBarOverlay({ color: nativeTheme.shouldUseDarkColors ? '#181818' : '#f4f4f4', symbolColor: nativeTheme.shouldUseDarkColors ? '#dddddd' : '#666666', height: 34 });
    syncTheme();
    nativeTheme.on('updated', syncTheme);
    mainWindow.on('closed', () => { nativeTheme.removeListener('updated', syncTheme); mainWindow = undefined; });
    mainWindow.on('close', event => { if (!quitting && tray && !tray.isDestroyed()) { event.preventDefault(); mainWindow?.hide(); } });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', event => event.preventDefault());
    mainWindow.webContents.on('context-menu', (_event, params) => {
        // Chromium does not supply an editing context menu automatically in Electron.
        const items: Electron.MenuItemConstructorOptions[] = [];
        if (params.isEditable) items.push(
            { role: 'undo', label: '撤销', enabled: params.editFlags.canUndo },
            { role: 'redo', label: '重做', enabled: params.editFlags.canRedo }, { type: 'separator' },
            { role: 'cut', label: '剪切', enabled: params.editFlags.canCut },
            { role: 'copy', label: '复制', enabled: params.editFlags.canCopy },
            { role: 'paste', label: '粘贴', enabled: params.editFlags.canPaste },
            { role: 'selectAll', label: '全选', enabled: params.editFlags.canSelectAll });
        else if (params.selectionText) items.push({ role: 'copy', label: '复制' }, { role: 'selectAll', label: '全选' });
        if (items.length) Menu.buildFromTemplate(items).popup({ window: mainWindow });
    });
    mainWindow.once('ready-to-show', () => { if (!process.env.MY_HARNESS_SCREENSHOT)
        mainWindow?.show(); });
    Menu.setApplicationMenu(null);
    await mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    if (process.argv.includes('--dev'))
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    if (process.env.MY_HARNESS_SCREENSHOT)
        setTimeout(async () => {
            if (!mainWindow || mainWindow.isDestroyed())
                return;
            try {
                const target = path.resolve(process.env.MY_HARNESS_SCREENSHOT!);
                await fs.writeFile(target, (await mainWindow.webContents.capturePage()).toPNG());
                const smoke = await mainWindow.webContents.executeJavaScript("({engine:'api',status:document.getElementById('agentStatus').innerText,websiteApiPresent:Object.keys(window.myHarness).some(key=>/web|login/i.test(key)),errors:[...document.querySelectorAll('.toast.error')].map(node=>node.innerText)})");
                await fs.writeFile(target + '.json', JSON.stringify({ version: app.getVersion(), ...smoke }, null, 2));
            }
            finally {
                app.quit();
            }
        }, 5000);
}
function assertTrusted(event: Electron.IpcMainInvokeEvent): void {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame || !event.senderFrame?.url.startsWith('file://'))
        throw new Error('拒绝不受信任的 IPC 请求');
}
function ensureWorkspace(): string { const cwd = settingsStore.get().cwd; if (!cwd)
    throw new Error('请先选择项目文件夹'); return path.resolve(cwd); }
// Realpath containment rejects junctions and symlinks outside the chosen project.
async function inside(target: string): Promise<string> {
    const root = await fs.realpath(ensureWorkspace());
    const resolved = await fs.realpath(path.resolve(target));
    const relative = path.relative(root, resolved);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
        throw new Error('文件路径超出当前工作区');
    return resolved;
}
function registerIpc(): void {
    ipcMain.handle('agent:sandbox-status', async event => { assertTrusted(event); return mydex.sandboxReadiness(); });
    ipcMain.handle('agent:setup-sandbox', async event => {
        assertTrusted(event); assertEngineIdle();
        const answer = await dialog.showMessageBox(mainWindow!, { type: 'warning', message: '设置 Windows 代理沙箱？', detail: '将调用内置引擎的官方沙箱设置流程，可能请求管理员批准，并创建低权限用户、文件访问规则和防火墙规则。取消不会改动系统。', buttons: ['取消', '继续设置'], defaultId: 0, cancelId: 0 });
        if (answer.response !== 1) return { started: false };
        assertEngineIdle(); sandboxSetupRunning = true;
        try { return await mydex.setupWindowsSandbox(ensureWorkspace()); }
        catch (error) { sandboxSetupRunning = false; throw error; }
    });
    ipcMain.handle('agent:get-permissions', (event, input: { key: string }) => {
        assertTrusted(event); return permissions.get(input.key, settingsStore.get());
    });
    ipcMain.handle('agent:set-permissions', async (event, input: { key: string; mode: string }) => {
        assertTrusted(event);
        if (!Object.hasOwn(PERMISSION_MODES, input.mode)) throw new Error('不支持的权限模式');
        if (activeTurns.has(input.key) || changingPermissions.has(input.key)) throw new Error('请先停止此对话，再修改权限');
        const previous = permissions.get(input.key, settingsStore.get());
        changingPermissions.add(input.key);
        try {
            if (input.mode === 'full') {
                const answer = await dialog.showMessageBox(mainWindow!, { type: 'warning', title: '允许完全访问？', message: '允许此对话不经审批访问文件、执行命令和联网？', detail: '这会取消代理的沙箱限制。它可能读取、修改或删除项目外的文件，以及向网络发送数据。仅影响当前对话；可在任务停止后切回请求批准。', buttons: ['取消', '允许完全访问'], defaultId: 0, cancelId: 0, noLink: true });
                if (answer.response !== 1) return previous;
            }
            if (activeTurns.has(input.key)) throw new Error('对话已开始运行，权限未修改');
            return await permissions.set(input.key, PERMISSION_MODES[input.mode]);
        } finally { changingPermissions.delete(input.key); }
    });
    ipcMain.handle('fs:reference-folder', async (event, input?: { directory?: string }) => {
        assertTrusted(event);
        const workspace = ensureWorkspace();
        let target = input?.directory;
        if (target === undefined) {
            const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory'], title: '引用当前项目内的文件夹', defaultPath: workspace });
            if (result.canceled || !result.filePaths[0]) return null;
            target = result.filePaths[0];
        }
        if (workspace !== ensureWorkspace()) throw new Error('项目已切换，请重新选择文件夹');
        return referenceFolder(workspace, target);
    });
    ipcMain.handle('app:save-profile', async (event, input: ProfileInput) => { assertTrusted(event); return changeConnection(() => settingsStore.saveProfile(input)); });
    ipcMain.handle('app:activate-profile', async (event, id: string) => { assertTrusted(event); return changeConnection(() => settingsStore.activateProfile(String(id))); });
    ipcMain.handle('app:delete-profile', async (event, id: string) => { assertTrusted(event); return changeConnection(() => settingsStore.deleteProfile(String(id))); });
    ipcMain.handle('app:list-models', async (event, profileId?: string) => {
        assertTrusted(event);
        const settings = settingsStore.get();
        const profile = settings.connectionProfiles.find(p => p.id === (profileId || settings.activeProfileId));
        if (!profile) throw new Error('请先保存 API 配置');
        return listApiModels(profile.apiBaseUrl, await settingsStore.readApiKey(profile.id));
    });
    ipcMain.handle('fs:reveal', async (event, input: { filePath: string }) => {
        assertTrusted(event);
        shell.showItemInFolder(await inside(String(input.filePath)));
    });
    registerWorkspaceTools(assertTrusted, ensureWorkspace, () => mainWindow!, sendEvent);
    ipcMain.handle('app:get-state', async (event) => {
        assertTrusted(event);
        let agentState: Record<string, unknown>;
        try {
            agentState = await mydex.initializeState();
        }
        catch (error) {
            agentState = { threads: [], models: [], error: String(error) };
        }
        return { version: app.getVersion(), settings: settingsStore.get(), agentState };
    });
    ipcMain.handle('app:choose-workspace', async (event) => {
        assertTrusted(event);
        const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'], title: '选择项目', defaultPath: settingsStore.get().cwd || undefined });
        if (result.canceled || !result.filePaths[0])
            return null;
        const settings = await settingsStore.update({ cwd: result.filePaths[0] });
        sendEvent('settings', settings);
        return settings;
    });
    ipcMain.handle('app:update-settings', async (event, patch: Partial<AgentSettings> & {
        apiKey?: string;
    }) => {
        assertTrusted(event);
        const allowed: Partial<AgentSettings> = {};
        if (connectionChanging) throw new Error('API 正在切换，请稍后修改设置');
        if (['apiBaseUrl', 'apiKey', 'localExecutable', 'contextWindow'].some(key => key in (patch || {}))) assertEngineIdle();
        for (const key of ['localExecutable', 'cwd', 'model', 'sandbox', 'approvalPolicy', 'theme', 'apiBaseUrl', 'reasoningEffort', 'contextWindow'] as const)
            if (key in (patch || {}))
                Object.assign(allowed, { [key]: patch[key] });
        if (allowed.localExecutable)
            validateExecutable(allowed.localExecutable);
        if (allowed.apiBaseUrl !== undefined) {
            const endpoint = new URL(allowed.apiBaseUrl);
            if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !(endpoint.protocol === 'https:' || (endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))))
                throw new Error('API 地址必须使用 HTTPS；本机允许 HTTP，地址中不能包含密钥');
            allowed.apiBaseUrl = endpoint.href.replace(/\/$/, '');
        }
        if (allowed.cwd && !(await fs.stat(allowed.cwd)).isDirectory())
            throw new Error('项目路径不是文件夹');
        if (allowed.sandbox && !['read-only', 'workspace-write', 'danger-full-access'].includes(allowed.sandbox))
            throw new Error('无效权限');
        if (allowed.approvalPolicy && !['untrusted', 'on-request', 'never'].includes(allowed.approvalPolicy))
            throw new Error('无效审批策略');
        if (allowed.theme && !['system', 'light', 'dark'].includes(allowed.theme))
            throw new Error('无效主题');
        if (allowed.reasoningEffort && !['none', 'low', 'medium', 'high', 'xhigh'].includes(allowed.reasoningEffort))
            throw new Error('无效思考强度');
        if (allowed.contextWindow !== undefined && (!Number.isInteger(allowed.contextWindow) || allowed.contextWindow < 4096 || allowed.contextWindow > 2000000))
            throw new Error('上下文容量应在 4096–2000000 之间');
        if ((allowed.sandbox === 'danger-full-access' && settingsStore.get().sandbox !== allowed.sandbox) || (allowed.approvalPolicy === 'never' && settingsStore.get().approvalPolicy !== allowed.approvalPolicy)) {
            const answer = await dialog.showMessageBox(mainWindow!, { type: 'warning', message: '放宽新对话的默认权限？', detail: '完全访问会取消文件和网络沙箱；从不询问会关闭审批。已有对话权限保持不变。', buttons: ['取消', '确认修改默认权限'], defaultId: 0, cancelId: 0 });
            if (answer.response !== 1) throw new Error('已取消修改默认权限');
        }
        if (patch.apiKey !== undefined)
            await settingsStore.saveApiKey(String(patch.apiKey));
        const settings = await settingsStore.update(allowed);
        if (allowed.model !== undefined || allowed.reasoningEffort !== undefined) await mydex.refreshModelCatalog(settings);
        nativeTheme.themeSource = settings.theme;
        sendEvent('settings', settings);
        return settings;
    });
    ipcMain.handle('app:menu', (event, name: string) => {
        assertTrusted(event);
        const action = (label: string, command: string): Electron.MenuItemConstructorOptions => ({ label, click: () => sendEvent('menu', command) });
        const menus: Record<string, Electron.MenuItemConstructorOptions[]> = {
            file: [action('新对话', 'new'), action('打开项目…', 'project'), action('导出对话…', 'export'), { type: 'separator' }, { role: 'quit', label: '退出' }],
            edit: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }],
            view: [action('切换侧栏', 'sidebar'), action('项目文件', 'files'), action('更改', 'changes'), action('命令面板', 'terminal'), { type: 'separator' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { role: 'resetZoom', label: '实际大小' }, { role: 'togglefullscreen', label: '全屏' }],
            help: [action('设置', 'settings'), { label: '关于 Mydex', click: () => void dialog.showMessageBox(mainWindow!, { message: 'Mydex ' + app.getVersion(), detail: 'Mydex · 仅 API\nElectron ' + process.versions.electron + ' / Chromium ' + process.versions.chrome + '\n开源代理核心：app-server 0.156.1\n独立客户端，不包含官方账户与云端服务。' }) }]
        };
        if (menus[name])
            Menu.buildFromTemplate(menus[name]).popup({ window: mainWindow });
    });
    ipcMain.handle('agent:restart', async (event) => { assertTrusted(event); assertEngineIdle(); await mydex.restart(); return mydex.initializeState(); });
    ipcMain.handle('agent:list-threads', async (event) => { assertTrusted(event); return mydex.listThreads(); });
    ipcMain.handle('agent:new-thread', async (event, input?: { key?: string }) => {
        assertTrusted(event); ensureWorkspace();
        if (connectionChanging) throw new Error('API 正在切换，请稍后发送');
        const settings = settingsStore.get();
        if (input?.key) {
            if (!input.key.startsWith('draft:') || changingPermissions.has(input.key)) throw new Error('正在修改权限，请稍后发送');
            Object.assign(settings, permissions.get(input.key, settings));
        }
        const thread = await mydex.startThread(settings);
        await permissions.set(thread.id, { sandbox: settings.sandbox, approvalPolicy: settings.approvalPolicy });
        threadWorkspaces.set(thread.id, thread.cwd || settings.cwd); return thread;
    });
    ipcMain.handle('agent:resume-thread', async (event, input: {
        threadId: string;
    }) => {
        assertTrusted(event);
        if (connectionChanging) throw new Error('API 正在切换，请稍后打开对话');
        const settings = settingsStore.get();
        Object.assign(settings, permissions.get(String(input.threadId), settings));
        const thread = await mydex.resumeThread(String(input.threadId), settings);
        await permissions.set(thread.id, { sandbox: settings.sandbox, approvalPolicy: settings.approvalPolicy });
        if (thread.cwd) threadWorkspaces.set(thread.id, thread.cwd);
        if (thread.cwd) {
            const settings = await settingsStore.update({ cwd: thread.cwd });
            sendEvent('settings', settings);
        }
        return thread;
    });
    ipcMain.handle('agent:start-turn', async (event, input: {
        threadId: string;
        prompt: string;
        folderReferences?: unknown;
    }) => {
        assertTrusted(event);
        ensureWorkspace();
        if (connectionChanging) throw new Error('API 正在切换，请稍后发送');
        const prompt = String(input.prompt || '').trim();
        if (!prompt || prompt.length > 500000)
            throw new Error('任务内容为空或过长');
        const settings = settingsStore.get();
        const threadId = String(input.threadId);
        if (changingPermissions.has(threadId)) throw new Error('正在修改权限，请稍后发送');
        Object.assign(settings, permissions.get(threadId, settings));
        if (activeTurns.has(threadId)) throw new Error('该对话正在运行，请等待完成或停止后再发送');
        // A different visible conversation may change the global project selection.
        // The submitted turn always belongs to its own thread's workspace.
        settings.cwd = threadWorkspaces.get(threadId) || settings.cwd;
        activeTurns.set(threadId, 'pending');
        try {
            const prepared = await prepareFolderPrompt(settings.cwd, prompt, input.folderReferences);
            if (sandboxSetupRunning) throw new Error('Windows 沙箱正在设置，请等待完成');
            if (settings.sandbox !== 'danger-full-access') {
                const sandbox = await mydex.sandboxReadiness();
                if (!['ready', 'notApplicable'].includes(sandbox.status)) throw new Error('Windows 沙箱尚未就绪，请在设置 → 权限与审批中设置沙箱；不会自动降级成完全访问');
            }
            return await mydex.startTurn(threadId, prepared, settings);
        }
        catch (error) { activeTurns.delete(threadId); throw error; }
    });
    ipcMain.handle('agent:interrupt', async (event, input: {
        threadId: string;
        turnId: string;
    }) => { assertTrusted(event); await mydex.interrupt(String(input.threadId), String(input.turnId)); });
    ipcMain.handle('agent:manage-thread', async (event, input: {
        action: string;
        threadId: string;
        name?: string;
    }) => { assertTrusted(event); return mydex.manageThread(String(input.action), String(input.threadId), String(input.name || '').slice(0, 120)); });
    ipcMain.handle('agent:approve', (event, input: {
        requestId: JsonRpcId;
        decision: string;
    }) => {
        assertTrusted(event);
        mydex.respond(input.requestId, approvalRequests.decision(input.requestId, input.decision));
    });
    ipcMain.handle('agent:grant-permissions', (event, input: { requestId: JsonRpcId; allow: boolean; scope: string }) => {
        assertTrusted(event); mydex.respond(input.requestId, approvalRequests.permissions(input.requestId, input.allow, input.scope));
    });
    ipcMain.handle('agent:answer', (event, input: {
        requestId: JsonRpcId;
        answers: Record<string, {
            answers: string[];
        }>;
    }) => { assertTrusted(event); mydex.respond(input.requestId, approvalRequests.answers(input.requestId, input.answers)); });
    ipcMain.handle('fs:list', async (event, input: {
        directory?: string;
    }) => {
        assertTrusted(event);
        const directory = await inside(input?.directory || ensureWorkspace());
        return (await fs.readdir(directory, { withFileTypes: true })).filter(entry => !['.git', 'node_modules', '.next'].includes(entry.name)).map(entry => ({ name: entry.name, path: path.join(directory, entry.name), type: entry.isDirectory() ? 'directory' : 'file' })).sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1);
    });
    ipcMain.handle('fs:read', async (event, input: {
        filePath: string;
    }) => {
        assertTrusted(event);
        const filePath = await inside(String(input.filePath));
        const stat = await fs.stat(filePath);
        if (!stat.isFile())
            throw new Error('只能预览文件');
        if (stat.size > 2000000)
            return { path: filePath, size: stat.size, kind: 'large', content: '' };
        const buffer = await fs.readFile(filePath);
        const binary = buffer.subarray(0, 8000).includes(0);
        return { path: filePath, size: stat.size, kind: binary ? 'binary' : 'text', content: binary ? '' : buffer.toString('utf8') };
    });
    ipcMain.handle('fs:open', async (event, input: {
        filePath: string;
    }) => {
        assertTrusted(event);
        const filePath = await inside(String(input.filePath));
        const answer = await dialog.showMessageBox(mainWindow!, { type: 'question', message: '在系统默认应用中打开此文件？', detail: filePath, buttons: ['取消', '打开'], defaultId: 0, cancelId: 0 });
        if (answer.response !== 1)
            return false;
        const error = await shell.openPath(filePath);
        if (error)
            throw new Error(error);
        return true;
    });
}
mydex.on('notification', value => {
    const p = value.params || {};
    if (value.method === 'windowsSandbox/setupCompleted') sandboxSetupRunning = false;
    if (value.method === 'turn/started' && p.threadId) activeTurns.set(p.threadId, p.turn?.id || 'running');
    if (value.method === 'turn/completed' && p.threadId) { activeTurns.delete(p.threadId); approvalRequests.clear(p.threadId); }
    if (value.method === 'serverRequest/resolved') approvalRequests.resolve(p.requestId);
    sendEvent('agent-notification', value);
});
mydex.on('status', value => { if (value.state === 'stopped') { activeTurns.clear(); approvalRequests.clear(); sandboxSetupRunning = false; } sendEvent('agent-status', value); });
mydex.on('log', value => sendEvent('agent-log', value));
mydex.on('request', (request: ServerRequest) => {
    if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/tool/requestUserInput', 'item/permissions/requestApproval'].includes(request.method)) {
        approvalRequests.add(request);
        sendEvent('agent-request', request);
    }
    else
        mydex.respondError(request.id, -32601, 'Mydex 暂不支持：' + request.method);
});
app.whenReady().then(async () => { registerIpc(); await createWindow(); createTray(); app.on('activate', () => { showMainWindow(); if (!BrowserWindow.getAllWindows().length)
    void createWindow().catch(error => dialog.showErrorBox('Mydex 启动失败', String(error))); }); }).catch(error => { dialog.showErrorBox('Mydex 启动失败', String(error)); app.quit(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin')
    app.quit(); });
app.on('before-quit', () => { quitting = true; tray?.destroy(); tray = undefined; mydex.dispose(); });
if (app.isPackaged && !process.env.MY_HARNESS_SCREENSHOT) {
    if (!app.requestSingleInstanceLock()) { quitting = true; app.quit(); }
    app.on('second-instance', showMainWindow);
}

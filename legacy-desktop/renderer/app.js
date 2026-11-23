(function () {
    'use strict';
    const api = window.myHarness;
    const $ = id => document.getElementById(id);
    const menus = window.mydexMenus;
    let models = [], modelRequest = 0, renameTarget = null;
    let editingProfileId = null;
    function renderConnections() {
        const s = state.settings;
        const profiles = s?.connectionProfiles || [];
        $('connectionSelect').replaceChildren(...profiles.map(p => new Option(p.name + (p.apiKeyConfigured ? '' : ' · 未填密钥'), p.id)));
        if (!profiles.length) $('connectionSelect').append(new Option('当前 API', ''));
        $('connectionSelect').append(new Option('＋ 新增 / 管理 API…', '__manage'));
        $('connectionSelect').value = s?.activeProfileId || '';
        const p = profiles.find(p => p.id === s?.activeProfileId);
        $('connectionHint').textContent = p ? 'Responses' : '';
        $('connectionSelect').title = p ? p.name + '\n' + p.apiBaseUrl + '\n' + (p.model || '尚未填写模型') : '在设置中添加 API';
    }
    function editProfile(id) {
        const s = state.settings;
        const profiles = s.connectionProfiles || [];
        editingProfileId = id || null;
        const p = profiles.find(p => p.id === id) || (!profiles.length ? s : { name: '', apiBaseUrl: '', model: '', contextWindow: 32768, reasoningEffort: 'none', apiKeyConfigured: false });
        $('profileSelect').replaceChildren(...profiles.map(p => new Option(p.name + (p.id === s.activeProfileId ? ' · 当前' : ''), p.id)));
        if (!id) $('profileSelect').append(new Option('正在新增 API…', ''));
        $('profileSelect').value = id || '';
        $('profileName').value = p.name || (!profiles.length ? '原有 API' : '');
        for (const [field, key] of [['apiBaseUrl','apiBaseUrl'],['apiModel','model'],['contextWindow','contextWindow'],['profileEffort','reasoningEffort']]) $(field).value = p[key] || '';
        $('apiKey').value = '';
        $('keyState').textContent = p.apiKeyConfigured ? '已加密保存；留空保留' : '未配置';
        $('deleteProfile').disabled = profiles.length <= 1 || !id;
        $('clearKeyButton').disabled = !p.apiKeyConfigured;
        $('modelListStatus').textContent = id ? '读取的是当前编辑配置已保存的地址与密钥' : '填写信息后点击“保存并连接”，再读取模型列表';
        $('apiModels').replaceChildren();
    }
    async function acceptConnection(result) {
        state.settings = result.settings;
        state.threads = result.agentState?.threads || state.threads;
        ++modelRequest; models = [];
        applySettings(); renderThreads();
        status('引擎就绪 · ' + (state.settings.apiKeyConfigured ? 'API 已配置' : '请填写密钥'));
    }
    async function switchConnection(id) {
        if (id === '__manage') { renderConnections(); openSettings(); return; }
        if (!id || id === state.settings.activeProfileId) return;
        if (anyRunning() || !canNavigate()) { renderConnections(); toast('请先等待所有任务完成或停止，再切换 API'); return; }
        state.busy = true; $('connectionSelect').disabled = true;
        try { await acceptConnection(await api.activateProfile(id)); toast('已切换 API；继续旧对话时会发送其上下文'); }
        finally { state.busy = false; $('connectionSelect').disabled = false; renderConnections(); }
        if (state.settings.apiKeyConfigured) void refreshModels();
    }
    let appearance = { fontSize: '14', density: 'comfortable' };
    try { const saved = JSON.parse(localStorage.getItem('myharness:appearance') || '{}');
        if (['13', '14', '16'].includes(saved.fontSize)) appearance.fontSize = saved.fontSize;
        if (['comfortable', 'compact'].includes(saved.density)) appearance.density = saved.density;
    } catch {}
    function applyAppearance(value = appearance) {
        document.documentElement.style.setProperty('--ui-font-size', value.fontSize + 'px');
        document.body.dataset.density = value.density;
    }
    applyAppearance();
    function settingsPage(page) {
        document.querySelectorAll('[data-settings-section]').forEach(node => node.classList.toggle('hidden', node.dataset.settingsSection !== page));
        document.querySelectorAll('[data-settings-page]').forEach(node => {
            node.classList.toggle('active', node.dataset.settingsPage === page);
            node.setAttribute('aria-current', String(node.dataset.settingsPage === page));
        });
    }
    function closeSettings() { $('settingsModal').classList.add('hidden'); $('apiKey').value = ''; applyAppearance(); $('settingsButton').focus(); }
    const action = (label, run, disabled = false) => ({ label, run: () => void guarded(run), disabled });
    const copy = async value => { await navigator.clipboard.writeText(value); toast('已复制'); };
    function taskActions(id) {
        return [action('打开任务', () => resume(id), state.busy),
            ...[['rename', '重命名'], ['fork', '分叉任务'], ['export', '导出 Markdown'], ['archive', '归档任务']]
                .map(([key, label]) => action(label, () => manage(key, undefined, id), !id || state.busy || conversations.get(id)?.running))];
    }
    function renderModels() {
        const current = state.settings?.model || '';
        const ids = [...new Set([current, ...models].filter(Boolean))];
        $('modelSelect').replaceChildren(...ids.map(id => new Option(id, id)));
        if (!ids.length) $('modelSelect').append(new Option('配置模型…', ''));
        const custom = new Option('手动配置模型…', ''); custom.dataset.action = 'configure';
        $('modelSelect').append(custom);
        $('modelSelect').value = current;
        $('apiModels').replaceChildren(...models.map(id => new Option(id, id)));
    }
    async function refreshModels() {
        const request = ++modelRequest;
        $('refreshModels').disabled = true;
        $('modelListStatus').textContent = '正在读取已保存 API 的模型列表…';
        try {
            const editorOpen = !$('settingsModal').classList.contains('hidden');
            const profileId = editorOpen ? editingProfileId : state.settings?.activeProfileId;
            if (editorOpen && !profileId && state.settings?.connectionProfiles?.length) throw new Error('请先保存新增 API，再刷新模型列表');
            const result = await api.listModels(profileId || undefined);
            if (request !== modelRequest) return;
            if (!profileId || profileId === state.settings?.activeProfileId) { models = result; renderModels(); }
            $('apiModels').replaceChildren(...result.map(id => new Option(id, id)));
            $('modelListStatus').textContent = `已读取 ${result.length} 个模型；列表不代表全部支持编程工具调用`;
        } catch (error) {
            if (request !== modelRequest) return;
            models = []; renderModels();
            $('modelListStatus').textContent = errorText(error);
            toast(errorText(error), true);
        } finally { if (request === modelRequest) $('refreshModels').disabled = false; }
    }
    const state = { settings: null, threads: [], threadId: null, turnId: null, running: false, busy: false,
        blocks: new Map(), items: new Set(), activities: new Map(), tabs: [], activeTab: 'welcome',
        preview: null, history: [], historyIndex: -1, collapsed: new Set(), expanded: new Set(), diff: '', summary: null,
        folderReferences: [], referenceEpoch: 0, referencePending: 0 };
    // Each open conversation owns its DOM/state snapshot and background event queue.
    // Moving nodes (not cloning HTML) preserves copy/approval handlers and partial streams.
    const conversations = new Map();
    let draftSequence = 1, conversationKey = 'draft:1';
    const conversationPanels = ['messageList', 'activityPanel', 'planPanel', 'diffContent', 'approvalStack'];
    const conversationFields = ['blocks', 'items', 'activities', 'diff', 'summary', 'turnId', 'running', 'tabs', 'activeTab', 'preview'];
    function conversation(key = conversationKey) {
        if (!conversations.has(key)) conversations.set(key, { key, open: true, queue: [], running: false, attention: false, title: '新对话' });
        return conversations.get(key);
    }
    const permissionModes = [
        { id: 'approval', label: '请求批准', sandbox: 'workspace-write', approvalPolicy: 'on-request', description: '工作区内操作；越界或联网时由引擎请求批准' },
        { id: 'readOnly', label: '只读', sandbox: 'read-only', approvalPolicy: 'on-request', description: '不直接修改文件；需要写入时请求额外批准' },
        { id: 'full', label: '完全访问', sandbox: 'danger-full-access', approvalPolicy: 'never', description: '取消沙箱限制，无需审批；仅用于可信任务' }
    ];
    function renderPermissions() {
        const p = conversation().permissions;
        const mode = permissionModes.find(m => m.sandbox === p?.sandbox && m.approvalPolicy === p?.approvalPolicy);
        const label = mode?.label || (p ? '自定义权限' : '读取权限中');
        $('permissionsButton').title = '当前对话权限：' + label + (mode ? '\n' + mode.description : '');
        $('permissionsButton').setAttribute('aria-label', '当前对话权限：' + label);
        $('permissionsButton').dataset.mode = mode?.id || 'custom';
        $('permissionsButton').disabled = state.running || state.busy || !p;
    }
    async function refreshPermissions(key = conversationKey) {
        const p = await api.getPermissions(key);
        conversation(key).permissions = p;
        if (key === conversationKey) renderPermissions();
        return p;
    }
    async function permissionMenu() {
        if (state.running || state.busy) return;
        const key = conversationKey, p = await refreshPermissions(key);
        if (key !== conversationKey || state.running || state.busy) return;
        menus.show($('permissionsButton'), [
            ...permissionModes.map(mode => ({ label: mode.label, description: mode.description,
                checked: mode.sandbox === p.sandbox && mode.approvalPolicy === p.approvalPolicy,
                run: () => void guarded(async () => {
                    if (key !== conversationKey || state.running || state.busy) return;
                    state.busy = true; renderPermissions();
                    try { conversation(key).permissions = await api.setPermissions(key, mode.id); }
                    finally { state.busy = false; renderPermissions(); }
                }) })),
            { label: '自动审查（尚未接入）', description: '需要独立审查能力；不会以关闭审批代替', disabled: true },
            action('新对话默认权限…', () => { openSettings(); settingsPage('permissions'); })
        ]);
    }
    async function checkSandbox() {
        const result = await api.sandboxStatus();
        $('sandboxStatus').textContent = '代理沙箱：' + ({ready:'引擎报告已就绪',notConfigured:'尚未配置，请先设置',updateRequired:'需要更新设置',notApplicable:'当前系统不使用 Windows 沙箱'}[result.status] || '状态未知，不能确认隔离有效');
        $('setupSandbox').disabled = result.status === 'notApplicable';
    }
    function saveConversation() {
        const view = conversation();
        view.snapshot = Object.fromEntries(conversationFields.map(key => [key, state[key]]));
        view.panels = Object.fromEntries(conversationPanels.map(id => [id, [...$(id).childNodes]]));
        view.draft = $('composer').value; view.folders = [...state.folderReferences];
        view.cwd = state.settings?.cwd; view.title = $('taskTitle').textContent;
        view.threadId = state.threadId; view.running = state.running;
        view.attention = Boolean($('approvalStack').childElementCount);
        view.scroll = $('messageList').scrollTop;
        view.status = [$('agentStatus').textContent, $('agentStatus').dataset.state];
        view.usage = $('usageLabel').textContent; view.changeCount = $('changeCount').textContent;
    }
    function anyRunning() { return state.running || [...conversations.values()].some(view => view.running); }
    function renderConversationTabs() {
        const root = $('conversationTabs'); root.replaceChildren();
        for (const view of conversations.values()) {
            if (!view.open) continue;
            const group = text('div', '', 'conversation-tab' + (view.key === conversationKey ? ' active' : ''));
            const activate = button((view.attention ? '待确认 · ' : view.running ? '运行中 · ' : '') + view.title, () => activateConversation(view.key));
            activate.setAttribute('role', 'tab'); activate.setAttribute('aria-selected', String(view.key === conversationKey));
            activate.title = view.title; activate.dataset.conversation = view.key;
            const close = button('×', async () => {
                if (state.busy) return;
                view.open = false;
                if (view.key === conversationKey) {
                    const next = [...conversations.values()].find(item => item.open);
                    if (next) await activateConversation(next.key); else blank();
                }
                renderConversationTabs();
            });
            close.setAttribute('aria-label', '关闭对话标签（不停止任务） ' + view.title);
            group.append(activate, close); root.append(group);
        }
        const add = button('+', blank); add.setAttribute('aria-label', '新建对话标签'); root.append(add);
    }
    async function activateConversation(key, track = true) {
        if (key === conversationKey || !canNavigate()) return;
        const view = conversations.get(key);
        if (!view?.snapshot) { if (!key.startsWith('draft:')) await resume(key); return; }
        saveConversation(); state.busy = true;
        try {
            if (view.threadId && !view.running) await api.resumeThread(view.threadId);
            if (view.cwd && view.cwd !== state.settings.cwd) await updateSettings({ cwd: view.cwd });
            conversationKey = key; view.open = true; view.attention = false;
            await refreshPermissions(key);
            state.threadId = view.threadId; Object.assign(state, view.snapshot);
            for (const id of conversationPanels) $(id).replaceChildren(...view.panels[id]);
            state.referenceEpoch++; state.folderReferences = [...(view.folders || [])];
            $('composer').value = view.draft || ''; autoSize();
            $('taskTitle').textContent = view.title;
            $('usageLabel').textContent = view.usage || ''; $('changeCount').textContent = view.changeCount || '';
            status(...view.status); running(state.running); renderTabs(); renderActive();
            showConversation(Boolean($('messageList').childElementCount));
            const queued = view.queue.splice(0);
            for (const event of queued) event.request ? approval(event.request) : notification(event);
            $('messageList').scrollTop = view.scroll || 0;
            if (state.threadId && track) remember(state.threadId);
        } finally { state.busy = false; renderPermissions(); renderFolderReferences(); renderConversationTabs(); renderThreads(); }
    }
    function queueBackground(key, event) {
        const view = conversation(key);
        const last = view.queue.at(-1);
        if (event.params?.delta && last?.method === event.method && last.params?.itemId === event.params.itemId && last.params?.processId === event.params.processId)
            last.params.delta += event.params.delta;
        else view.queue.push(event);
        if (event.method === 'turn/started') view.running = true;
        if (event.method === 'turn/completed') { view.running = false; view.attention = true; }
        if (event.request) view.attention = true;
        renderConversationTabs(); renderThreads();
    }
    function renderFolderReferences() {
        const root = $('folderReferences');
        root.replaceChildren();
        for (const ref of state.folderReferences) {
            const chip = text('div', '', 'folder-reference');
            chip.title = ref.path;
            const remove = button('×', () => {
                if (state.running || state.busy) return;
                state.folderReferences = state.folderReferences.filter(item => item.path !== ref.path);
                renderFolderReferences();
            });
            remove.setAttribute('aria-label', '移除文件夹引用 ' + ref.relativePath);
            remove.disabled = state.running || state.busy;
            chip.append(window.mydexIcon('folder'), text('span', ref.relativePath === '.' ? basename(ref.path) + '（项目）' : ref.relativePath), remove);
            root.append(chip);
        }
        root.classList.toggle('hidden', !state.folderReferences.length);
    }
    function clearFolderReferences() {
        state.referenceEpoch++;
        state.folderReferences = [];
        renderFolderReferences();
    }
    async function addFolderReference(directory) {
        if (state.running || state.busy) { toast('请先停止当前任务'); return; }
        if (!state.settings.cwd) { await chooseWorkspace(); if (!state.settings.cwd) return; }
        const epoch = state.referenceEpoch, workspace = state.settings.cwd;
        state.referencePending++;
        try {
            const ref = await api.referenceFolder(directory);
            if (!ref) return;
            if (epoch !== state.referenceEpoch || workspace !== state.settings.cwd || state.running || state.busy) {
                toast('任务或项目已切换，未添加旧文件夹引用'); return;
            }
            if (state.folderReferences.some(item => item.path === ref.path)) { toast('该文件夹已经引用'); return; }
            if (state.folderReferences.length >= 20) throw new Error('每次任务最多引用 20 个文件夹');
            state.folderReferences.push(ref); renderFolderReferences();
            $('composer').focus(); toast('已引用文件夹；发送后由代理按需读取');
        } finally { state.referencePending--; }
    }
    const names = { welcome: '工作区', files: '项目文件', changes: '更改', plan: '计划', activity: '活动' };
    const basename = value => String(value || '').replace(/[\\/]$/, '').split(/[\\/]/).pop() || '';
    const time = value => Number(value) < 1e12 ? Number(value) * 1000 : Number(value);
    const title = thread => thread.name || String(thread.preview || '').split('\n')[0].slice(0, 90) || '新对话';
    const text = (tag, value, className) => { const node = document.createElement(tag); node.textContent = value; if (className)
        node.className = className; return node; };
    const button = (label, handler, className) => { const node = text('button', label, className); node.onclick = () => void guarded(handler); return node; };
    const errorText = error => String(error?.message || error || '未知错误').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
    function toast(value, error = false) { const node = text('div', value, 'toast' + (error ? ' error' : '')); $('toastRegion').append(node); setTimeout(() => node.remove(), 5000); }
    async function guarded(action) { try {
        return await action();
    }
    catch (error) {
        toast(errorText(error), true);
    } }
    function status(label, value = 'ready') { $('agentStatus').textContent = label; $('agentStatus').dataset.state = value; }
    function canNavigate() { if (state.busy) {
        toast('正在切换或提交，请稍后');
        return false;
    } return true; }
    function running(value) {
        state.running = Boolean(value);
        $('stopButton').classList.toggle('hidden', !value);
        $('sendButton').classList.toggle('hidden', value);
        for (const id of ['modelSelect', 'effortSelect'])
            $(id).disabled = Boolean(value);
        $('composer').disabled = Boolean(value);
        conversation().running = Boolean(value);
        renderPermissions();
        renderConversationTabs();
        renderFolderReferences();
    }
    function persistLayout() {
        localStorage.setItem('myharness:layout:v2', JSON.stringify({ sidebar: document.documentElement.style.getPropertyValue('--sidebar-width'), chat: document.documentElement.style.getPropertyValue('--chat-width'), collapsed: [...state.collapsed] }));
    }
    function restoreLayout() {
        try {
            const saved = JSON.parse(localStorage.getItem('myharness:layout:v2') || '{}');
            for (const [key, variable] of [['sidebar', '--sidebar-width'], ['chat', '--chat-width']])
                if (/^\d+px$/.test(saved[key]))
                    document.documentElement.style.setProperty(variable, saved[key]);
            state.collapsed = new Set(saved.collapsed || []);
        }
        catch { }
    }
    function resizeHandle(id, variable, min, max, offset) {
        const node = $(id);
        const set = value => document.documentElement.style.setProperty(variable, Math.round(Math.max(min, Math.min(max(), value))) + 'px');
        node.onpointerdown = event => {
            if (event.button !== 0)
                return;
            node.setPointerCapture(event.pointerId);
            document.body.classList.add('resizing');
            node.onpointermove = e => set(e.clientX - offset());
            node.onpointerup = () => { node.onpointermove = null; node.releasePointerCapture(event.pointerId); document.body.classList.remove('resizing'); persistLayout(); };
            node.onlostpointercapture = () => { node.onpointermove = null; document.body.classList.remove('resizing'); };
        };
        node.onkeydown = event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
            event.preventDefault();
            set(node.parentElement.getBoundingClientRect().width + (event.key === 'ArrowRight' ? 10 : -10));
            persistLayout();
        } };
    }
    function applySettings() {
        const s = state.settings;
        if (!s)
            return;
        $('workspaceName').textContent = basename(s.cwd) || '未选择项目';
        $('workspaceName').title = s.cwd || '';
        $('taskPath').textContent = s.cwd ? basename(s.cwd) + ' · 描述你想完成的事情。' : '选择项目，描述你想完成的事情。';
        $('accountPlan').textContent = s.apiKeyConfigured ? '自己的 API' : '配置 API';
        renderConnections();
        renderModels();
        $('effortSelect').value = s.reasoningEffort || 'medium';
    }
    async function updateSettings(patch) { const oldCwd = state.settings?.cwd; state.settings = await api.updateSettings(patch); applySettings(); if (oldCwd !== state.settings.cwd)
        clearFiles(); }
    async function refreshThreads() {
        state.threads = await api.listThreads();
        for (const view of conversations.values()) if (view.running && view.threadId && !state.threads.some(t => t.id === view.threadId))
            state.threads.push({ id: view.threadId, cwd: view.cwd, name: view.title, updatedAt: Date.now()/1000 });
        renderThreads();
    }
    async function newProjectConversation(cwd, files = false) {
        if (!canNavigate()) return;
        saveConversation(); await updateSettings({ cwd }); blank(false);
        if (files) await browse();
    }
    function renderThreads() {
        const root = $('threadList');
        root.replaceChildren();
        const query = $('taskSearch').value.trim().toLowerCase();
        const groups = new Map((state.settings?.projects || []).map(p => [p, []]));
        for (const thread of [...state.threads].sort((a, b) => time(b.updatedAt) - time(a.updatedAt))) {
            if (thread.archived || !title(thread).toLowerCase().includes(query))
                continue;
            const cwd = thread.cwd || '';
            if (!groups.has(cwd))
                groups.set(cwd, []);
            groups.get(cwd).push(thread);
        }
        for (const [cwd, threads] of groups) {
            if (query && !threads.length)
                continue;
            const group = text('section', '', 'project-group');
            group.dataset.project = cwd;
            const head = button('', () => { if (state.collapsed.has(cwd))
                state.collapsed.delete(cwd);
            else
                state.collapsed.add(cwd); persistLayout(); renderThreads(); }, 'project-heading');
            head.append(window.mydexIcon('folder'), text('span', basename(cwd) || '其他任务'), text('small', state.collapsed.has(cwd) ? '›' : '⌄'));
            head.title = cwd;
            head.setAttribute('aria-expanded', String(!state.collapsed.has(cwd)));
            menus.bind(head, () => [
                action('在此项目新建对话', () => newProjectConversation(cwd), !cwd || state.busy),
                action('查看项目文件', async () => { if (cwd !== state.settings.cwd) await newProjectConversation(cwd, true); else await browse(); }, !cwd || state.busy),
                action('复制项目路径', () => copy(cwd), !cwd),
                action(state.collapsed.has(cwd) ? '展开项目' : '折叠项目', () => head.click())
            ]);
            group.append(head);
            if (!state.collapsed.has(cwd) || query) {
                const visible = query || state.expanded.has(cwd) ? threads : threads.slice(0, 6);
                for (const thread of visible) {
                    const item = button(title(thread), () => resume(thread.id), 'thread-item' + (thread.id === state.threadId ? ' active' : ''));
                    item.title = title(thread) + '\n' + new Date(time(thread.updatedAt) || Date.now()).toLocaleString();
                    item.dataset.threadId = thread.id;
                    item.dataset.running = String(Boolean(conversations.get(thread.id)?.running));
                    item.dataset.attention = String(Boolean(conversations.get(thread.id)?.attention));
                    menus.bind(item, () => taskActions(thread.id));
                    group.append(item);
                }
                if (threads.length > 6 && !query)
                    group.append(button(state.expanded.has(cwd) ? '收起' : '展开显示', () => { if (state.expanded.has(cwd))
                        state.expanded.delete(cwd);
                    else
                        state.expanded.add(cwd); renderThreads(); }, 'expand-project'));
                if (!threads.length)
                    group.append(button('在此项目新建对话', () => newProjectConversation(cwd), 'empty-project'));
            }
            root.append(group);
        }
        if (!groups.size)
            root.append(text('p', '添加一个项目，开始你的第一段对话。', 'sidebar-empty'));
    }
    function clearConversation() {
        state.blocks = new Map();
        state.items = new Set();
        state.activities = new Map();
        state.diff = '';
        state.summary = null;
        for (const id of ['messageList', 'activityPanel', 'planPanel', 'diffContent', 'approvalStack'])
            $(id).replaceChildren();
        $('usageLabel').textContent = '';
        $('changeCount').textContent = '';
    }
    function blank(save = true) {
        if (!canNavigate())
            return;
        if (save) saveConversation(); conversationKey = 'draft:' + (++draftSequence); conversation();
        void guarded(() => refreshPermissions());
        state.threadId = null;
        clearFolderReferences();
        state.turnId = null;
        clearConversation();
        $('composer').value = ''; autoSize();
        $('taskTitle').textContent = '新对话';
        $('messageList').classList.add('hidden');
        $('emptyState').classList.remove('hidden');
        running(false);
        renderThreads();
        $('composer').focus();
    }
    async function chooseWorkspace() { if (!canNavigate())
        return; saveConversation(); const value = await api.chooseWorkspace(); if (value) {
        state.settings = value;
        clearFiles();
        applySettings();
        blank(false);
        await refreshThreads();
    } }
    function remember(id) {
        if (state.history[state.historyIndex] === id)
            return;
        state.history = state.history.slice(0, state.historyIndex + 1);
        state.history.push(id);
        state.historyIndex = state.history.length - 1;
        navigationButtons();
    }
    function navigationButtons() { $('goBack').disabled = state.historyIndex <= 0; $('goForward').disabled = state.historyIndex >= state.history.length - 1; }
    async function navigateHistory(step) {
        if (!canNavigate())
            return;
        const next = state.historyIndex + step;
        if (next < 0 || next >= state.history.length)
            return;
        if (await resume(state.history[next], false)) {
            state.historyIndex = next;
            navigationButtons();
        }
    }
    async function resume(id, track = true) {
        if (!canNavigate())
            return false;
        if (conversations.get(id)?.snapshot && id !== conversationKey) { await activateConversation(id, track); return true; }
        if (id === conversationKey && state.running) return true;
        saveConversation();
        state.busy = true;
        try {
            const thread = await api.resumeThread(id);
            if (track || state.threadId !== thread.id) clearFolderReferences();
            state.threadId = thread.id;
            conversationKey = thread.id;
            await refreshPermissions(thread.id);
            const view = conversation(); view.open = true; view.threadId = thread.id; view.cwd = thread.cwd; view.title = title(thread);
            $('composer').value = ''; autoSize();
            if (thread.cwd && thread.cwd !== state.settings.cwd) {
                state.settings.cwd = thread.cwd;
                clearFiles();
                applySettings();
            }
            clearConversation();
            $('taskTitle').textContent = title(thread);
            for (const turn of thread.turns || [])
                for (const item of turn.items || [])
                    renderItem(item, true);
            showConversation(Boolean($('messageList').childElementCount));
            const last = thread.turns?.at(-1);
            state.turnId = last?.status === 'inProgress' ? last.id : null;
            running(Boolean(state.turnId));
            // History already contains completed items. Rebuild only still-live requests;
            // never resurrect an approval resolved while this thread was not loaded.
            const pendingApprovals = new Map();
            for (const event of view.queue.splice(0)) {
                if (event.request) pendingApprovals.set(event.request.id, event.request);
                if (event.method === 'serverRequest/resolved') pendingApprovals.delete(event.params?.requestId);
                if (event.method === 'turn/completed') pendingApprovals.clear();
            }
            for (const request of pendingApprovals.values()) approval(request);
            if (track)
                remember(id);
            renderThreads();
            return true;
        }
        finally {
            state.busy = false;
            renderPermissions();
        }
    }
    function showConversation(show = true) { $('emptyState').classList.toggle('hidden', show); $('messageList').classList.toggle('hidden', !show); }
    async function send() {
        const prompt = $('composer').value.trim();
        if (state.referencePending) { toast('正在添加文件夹引用，请稍后发送'); return; }
        if (!prompt && state.folderReferences.length) { toast('请描述需要对引用文件夹完成的任务'); $('composer').focus(); return; }
        if (!prompt || state.running || state.busy)
            return;
        if (!state.settings.apiKeyConfigured || !state.settings.model) {
            openSettings();
            toast('请先配置 API Key 和模型 ID');
            return;
        }
        if (!state.settings.cwd) {
            await chooseWorkspace();
            if (!state.settings.cwd)
                return;
        }
        state.busy = true;
        running(true);
        try {
            if (!state.threadId) {
                await refreshPermissions();
                const thread = await api.newThread(conversationKey);
                const previous = conversation(); conversations.delete(conversationKey);
                const pending = conversations.get(thread.id);
                conversationKey = thread.id; previous.key = thread.id; previous.threadId = thread.id;
                if (pending) previous.queue.push(...pending.queue);
                conversations.set(thread.id, previous);
                state.threadId = thread.id;
                const entry = { ...thread, name: prompt.split('\n')[0].slice(0, 90), cwd: state.settings.cwd, updatedAt: Date.now()/1000 };
                state.threads = [entry, ...state.threads.filter(item => item.id !== thread.id)];
                previous.title = entry.name; previous.cwd = entry.cwd; renderThreads(); renderConversationTabs();
                remember(thread.id);
            }
            showConversation();
            const turn = await api.startTurn(state.threadId, prompt, state.folderReferences.map(ref => ({ ...ref })));
            state.turnId = turn.id;
            clearFolderReferences();
            $('composer').value = '';
            autoSize();
            if ($('taskTitle').textContent === '新对话')
                $('taskTitle').textContent = prompt.split('\n')[0].slice(0, 90);
            status('正在处理', 'starting');
            conversation().title = $('taskTitle').textContent; renderConversationTabs();
        }
        catch (error) {
            running(false);
            throw error;
        }
        finally {
            state.busy = false;
            renderPermissions();
            renderFolderReferences();
        }
    }
    async function stop() { if (state.threadId && state.turnId)
        await api.interruptTurn(state.threadId, state.turnId); }
    const markdownFrames = new WeakMap();
    function nearMessageBottom() { const node = $('messageList'); return node.scrollHeight - node.scrollTop - node.clientHeight < 72; }
    function scrollMessages() { const node = $('messageList'), key = conversationKey; requestAnimationFrame(() => { if (key === conversationKey) node.scrollTop = node.scrollHeight; }); }
    function userMessage(value) {
        const raw = String(value), node = text('article', '', 'message user'), body = text('div', raw, 'message-body');
        body.dataset.raw = raw;
        // Display the persisted path metadata as chips; never execute or trust it as instructions.
        const match = /\n\n\[My Harness 文件夹引用\]\n[^\n]*\n(\[[\s\S]*\])\n\[\/My Harness 文件夹引用\]$/.exec(raw);
        if (match) {
            try {
                const refs = JSON.parse(match[1]);
                if (Array.isArray(refs) && refs.length <= 20 && refs.every(ref => ref && ref.type === 'directory' && typeof ref.path === 'string' && typeof ref.relativePath === 'string')) {
                    body.textContent = raw.slice(0, match.index);
                    const chips = text('div', '', 'sent-folder-references');
                    for (const ref of refs) {
                        const chip = text('span', '', 'folder-reference'); chip.title = ref.path;
                        chip.append(window.mydexIcon('folder'), text('span', ref.relativePath === '.' ? basename(ref.path) : ref.relativePath));
                        chips.append(chip);
                    }
                    body.append(chips);
                }
            } catch { /* Malformed or unrelated text remains visible as plain text. */ }
        }
        node.append(body); $('messageList').append(node); showConversation(); scrollMessages();
    }
    function assistant(id) {
        if (state.blocks.has(id))
            return state.blocks.get(id);
        const article = text('article', '', 'message assistant');
        const body = text('div', '', 'message-content');
        article.append(body);
        $('messageList').append(article);
        state.blocks.set(id, body);
        showConversation();
        return body;
    }
    function markdown(node, value) {
        if (markdownFrames.has(node)) cancelAnimationFrame(markdownFrames.get(node));
        markdownFrames.delete(node);
        window.mydexMarkdown.render(node, value);
    }
    function streamMarkdown(node, delta) {
        node.dataset.raw = (node.dataset.raw || '') + delta;
        if (markdownFrames.has(node)) return;
        markdownFrames.set(node, requestAnimationFrame(() => {
            const follow = node.isConnected && nearMessageBottom();
            markdownFrames.delete(node);
            window.mydexMarkdown.render(node, node.dataset.raw || '');
            if (follow) scrollMessages();
        }));
    }
    function renderItem(item, complete) {
        if (!item)
            return;
        const id = item.id || item.type + Date.now();
        if (item.type === 'userMessage') {
            if (!state.items.has(id)) {
                userMessage((item.content || []).filter(p => p.type === 'text').map(p => p.text).join('\n'));
                state.items.add(id);
            }
            return;
        }
        if (item.type === 'agentMessage') {
            const follow = nearMessageBottom();
            const block = assistant(id);
            if (complete && typeof item.text === 'string') {
                markdown(block, item.text);
                if (!block.parentElement.querySelector('.message-actions')) {
                    const actions = text('div', '', 'message-actions');
                    const copy = button('', () => navigator.clipboard.writeText(block.dataset.raw || block.textContent));
                    copy.append(window.mydexIcon('copy'));
                    copy.title = '复制回复';
                    copy.setAttribute('aria-label', '复制回复');
                    actions.append(copy);
                    block.parentElement.append(actions);
                }
            }
            if (follow) scrollMessages();
            return;
        }
        if (item.type === 'commandExecution')
            activity(id, '命令执行', (item.command || '') + '\n' + (item.aggregatedOutput || ''), item.status);
        else if (item.type === 'reasoning')
            activity(id, '思考', [...(item.summary || []), ...(item.content || [])].map(p => typeof p === 'string' ? p : JSON.stringify(p)).join('\n'), complete ? '完成' : '进行中');
        else if (item.type === 'fileChange') {
            activity(id, '文件更改', (item.changes || []).map(c => c.path || c.file || '').join('\n'), item.status);
            const changes = (item.changes || []).filter(c => c.diff).map(c => 'diff --git a/' + c.path + ' b/' + c.path + '\n' + c.diff).join('\n');
            if (changes)
                renderDiff(changes);
        }
        else
            activity(id, item.type, JSON.stringify(item, null, 2), item.status);
    }
    function activity(id, title, body, statusValue) {
        let card = state.activities.get(id);
        if (!card) {
            card = text('section', '', 'activity-card');
            const header = text('header', '');
            header.append(text('strong', title), text('small', ''));
            card.append(header, text('pre', ''));
            $('activityPanel').append(card);
            state.activities.set(id, card);
        }
        card.querySelector('small').textContent = statusValue || '';
        if (body !== undefined)
            card.querySelector('pre').textContent = body;
        return card;
    }
    function renderDiff(value, fromGit = false) {
        state.diff = String(value || '');
        const root = $('diffContent');
        root.replaceChildren();
        for (const line of state.diff.split('\n'))
            root.append(text('span', line + '\n', line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-remove' : line.startsWith('@@') ? 'diff-hunk' : ''));
        const files = [...state.diff.matchAll(/^diff --git a\/.+? b\/(.+)$/gm)].map(match => match[1]);
        const added = (state.diff.match(/^\+(?!\+\+)/gm) || []).length;
        const removed = (state.diff.match(/^-(?!--)/gm) || []).length;
        $('changeCount').textContent = files.length || '';
        if (!fromGit && files.length) {
            if (!state.summary) {
                state.summary = text('section', '', 'change-summary');
                $('messageList').append(state.summary);
            }
            state.summary.replaceChildren();
            const header = text('header', '');
            header.append(text('strong', '已编辑 ' + files.length + ' 个文件'), text('span', '+' + added, 'diff-add'), text('span', '−' + removed, 'diff-remove'), button('审核', () => openPanel('changes'), 'outlined'));
            state.summary.append(header);
            for (const file of files.slice(0, 5))
                state.summary.append(button(file, () => openPanel('changes'), 'changed-file'));
            if (files.length > 5)
                state.summary.append(button('再显示 ' + (files.length - 5) + ' 个文件', () => openPanel('changes'), 'changed-file'));
        }
    }
    function plan(entries, explanation) {
        const root = $('planPanel');
        root.replaceChildren();
        if (explanation)
            root.append(text('p', explanation));
        const list = text('ol', '', 'plan-list');
        for (const entry of entries || []) {
            const li = text('li', (entry.status === 'completed' ? '✓ ' : entry.status === 'inProgress' ? '● ' : '○ ') + entry.step);
            li.dataset.status = entry.status;
            list.append(li);
        }
        root.append(list);
    }
    function approval(request) {
        if ([...$('approvalStack').children].some(card => card.dataset.requestKey === JSON.stringify(request.id))) return;
        const card = text('section', '', 'approval-card');
        card.dataset.requestId = String(request.id);
        card.dataset.requestKey = JSON.stringify(request.id);
        const p = request.params || {};
        card.append(text('small', '当前对话 · ' + (p.cwd || state.settings.cwd || '') + (p.turnId ? '\n任务轮次：' + p.turnId : ''), 'approval-scope'));
        const submit = async operation => {
            const controls = [...card.querySelectorAll('button')]; controls.forEach(n => n.disabled = true);
            try { await operation(); card.remove(); conversation().attention = Boolean($('approvalStack').childElementCount); renderConversationTabs(); }
            catch (error) { controls.forEach(n => n.disabled = false); throw error; }
        };
        if (request.method === 'item/tool/requestUserInput') {
            const inputs = [];
            for (const q of p.questions || []) {
                const label = text('label', q.question);
                const input = document.createElement('input');
                input.placeholder = (q.options || []).map(o => o.label).join(' / ');
                label.append(input);
                card.append(label);
                inputs.push({ id: q.id, input });
            }
            card.append(button('提交回答', () => submit(() => api.answer(request.id, Object.fromEntries(inputs.map(({ id, input }) => [id, { answers: [input.value] }])))), 'primary'));
        }
        else if (request.method === 'item/permissions/requestApproval') {
            card.append(text('strong', '允许额外的文件 / 网络权限？'), text('p', p.reason || '引擎请求下列额外权限。只授予这里列出的范围。'));
            const requested = p.permissions || {}, fs = requested.fileSystem;
            const lines = [];
            if (requested.network) lines.push('网络访问：' + (requested.network.enabled === true ? '允许联网' : String(requested.network.enabled)));
            if (fs) {
                for (const field of ['read', 'write']) for (const path of fs[field] || []) lines.push((field === 'read' ? '读取：' : '写入：') + path);
                // New core versions may send structured entries: show them without hiding scope.
                if (fs.entries?.length) lines.push('文件系统规则：\n' + JSON.stringify(fs.entries, null, 2));
                if (fs.globScanMaxDepth != null) lines.push('规则扫描深度：' + fs.globScanMaxDepth);
            }
            card.append(text('pre', lines.join('\n') || '未请求额外权限'));
            const actions = text('div', '', 'approval-actions');
            for (const [label, allow, scope] of [['拒绝', false, 'turn'], ['本轮允许', true, 'turn'], ['本会话允许', true, 'session']])
                actions.append(button(label, () => submit(() => api.grantPermissions(request.id, allow, scope)), 'outlined'));
            card.append(actions);
        }
        else {
            const command = request.method.includes('commandExecution');
            const network = p.networkApprovalContext;
            card.append(text('strong', network ? '允许网络访问？' : command ? '允许执行命令？' : '允许修改文件？'), text('pre', [network ? '网络目标：' + network.protocol + '://' + network.host : '', p.command, p.reason, p.grantRoot ? '授权根目录：' + p.grantRoot : '', p.changes ? JSON.stringify(p.changes, null, 2) : ''].filter(Boolean).join('\n')));
            card.append(text('small', '本次允许仅处理当前请求；本会话允许的具体作用范围由引擎决定，不会开启全局完全访问。', 'approval-scope'));
            const actions = text('div', '', 'approval-actions');
            for (const [label, decision] of [['拒绝', 'decline'], ['本次允许', 'accept'], ['本会话允许', 'acceptForSession'], ['取消', 'cancel']]) {
                if (Array.isArray(p.availableDecisions) && !p.availableDecisions.includes(decision)) continue;
                actions.append(button(label, () => submit(() => api.approve(request.id, decision)), 'outlined'));
            }
            card.append(actions);
        }
        $('approvalStack').append(card);
    }
    function notification(value) {
        const p = value.params || {};
        if (p.threadId && p.threadId !== state.threadId) { queueBackground(p.threadId, value); return; }
        switch (value.method) {
            case 'windowsSandbox/setupCompleted':
                toast(p.success ? '沙箱设置完成' : '沙箱设置失败：' + (p.error || '请检查系统权限'), !p.success);
                $('setupSandbox').disabled = false; void guarded(checkSandbox); break;
            case 'turn/started':
                state.turnId = p.turn?.id;
                running(true);
                break;
            case 'turn/completed':
                state.turnId = null;
                running(false);
                $('approvalStack').replaceChildren();
                status(p.turn?.status === 'completed' ? '任务已完成' : '任务已结束');
                if (p.turn?.error)
                    toast(p.turn.error.message || '任务失败', true);
                void guarded(refreshThreads);
                break;
            case 'serverRequest/resolved':
                for (const card of [...$('approvalStack').children]) if (card.dataset.requestKey === JSON.stringify(p.requestId)) card.remove();
                break;
            case 'item/started':
                renderItem(p.item, false);
                break;
            case 'item/completed':
                renderItem(p.item, true);
                break;
            case 'item/agentMessage/delta': {
                const block = assistant(p.itemId);
                streamMarkdown(block, String(p.delta || ''));
                break;
            }
            case 'item/reasoning/summaryTextDelta':
            case 'item/reasoning/textDelta':
            case 'item/commandExecution/outputDelta':
            case 'command/exec/outputDelta':
            case 'process/outputDelta': {
                const id = p.itemId || p.processId || 'output';
                const card = activity(id, value.method.includes('reasoning') ? '思考' : '命令输出', undefined, '进行中');
                card.querySelector('pre').textContent += String(p.delta || '');
                break;
            }
            case 'turn/diff/updated':
                renderDiff(p.diff);
                break;
            case 'turn/plan/updated':
                plan(p.plan, p.explanation);
                break;
            case 'thread/tokenUsage/updated': {
                const total = p.tokenUsage?.total?.totalTokens;
                $('usageLabel').textContent = total == null ? '' : Number(total).toLocaleString() + ' tokens';
                break;
            }
            case 'error':
                toast(p.message || p.error?.message || JSON.stringify(p), true);
                break;
            case 'warning':
            case 'configWarning':
                activity('notice-' + Date.now(), '提示', JSON.stringify(p, null, 2));
                break;
        }
    }
    function hostEvent({ channel, payload }) {
        if (channel === 'agent-notification')
            notification(payload);
        if (channel === 'agent-request') {
            if (!payload.params?.threadId || payload.params.threadId === state.threadId)
                approval(payload);
            else queueBackground(payload.params.threadId, { request: payload });
        }
        if (channel === 'agent-log')
            activity('log-' + Date.now(), '运行时', String(payload));
        if (channel === 'agent-status') {
            status(payload.state === 'ready' ? '引擎已就绪' : payload.state === 'starting' ? '正在连接引擎' : '引擎已停止', payload.state);
            if (payload.state === 'stopped') {
                for (const view of conversations.values()) { view.running = false; view.queue = []; if (view.snapshot) { view.snapshot.running = false; view.snapshot.turnId = null; view.panels.approvalStack = []; view.status = ['引擎已停止', 'stopped']; } }
                running(false);
                state.turnId = null;
            }
            if (payload.detail)
                toast(payload.detail, true);
        }
        if (channel === 'settings') {
            const old = state.settings?.cwd;
            state.settings = payload;
            if (old !== payload.cwd)
                clearFiles();
            applySettings();
        }
        if (channel === 'terminal') {
            const out = $('terminalOutput');
            out.textContent = (out.textContent + payload.text).slice(-300000);
            out.scrollTop = out.scrollHeight;
            $('terminalForm').querySelector('button').disabled = payload.running;
        }
        if (channel === 'menu') {
            const map = { new: blank, project: chooseWorkspace, export: () => manage('export'), sidebar: toggleSidebar, files: browse, changes: git, terminal: () => $('terminalPanel').classList.toggle('hidden'), settings: openSettings };
            if (map[payload])
                void guarded(map[payload]);
        }
    }
    function openPanel(id, label) {
        document.querySelector('.agent-layout').classList.remove('inspector-hidden');
        if (!state.tabs.some(tab => tab.id === id))
            state.tabs.push({ id, label: label || names[id] || basename(id) });
        state.activeTab = id;
        renderTabs();
        renderActive();
    }
    function closeTab(id) {
        const index = state.tabs.findIndex(tab => tab.id === id);
        state.tabs = state.tabs.filter(tab => tab.id !== id);
        if (state.activeTab === id)
            state.activeTab = state.tabs[Math.max(0, index - 1)]?.id || 'welcome';
        renderTabs();
        renderActive();
    }
    function renderTabs() {
        $('tabList').replaceChildren();
        for (const tab of state.tabs) {
            const node = text('div', '', 'workbench-tab' + (tab.id === state.activeTab ? ' active' : ''));
            node.setAttribute('role', 'presentation');
            const select = button('', () => { state.activeTab = tab.id; renderTabs(); renderActive(); });
            select.setAttribute('role', 'tab');
            select.setAttribute('aria-selected', String(tab.id === state.activeTab));
            select.append(window.mydexIcon(tab.id === 'files' ? 'folder' : 'file'), text('span', tab.label));
            select.title = tab.id;
            menus.bind(select, () => [
                action('关闭标签', () => closeTab(tab.id)),
                action('关闭其他标签', () => { state.tabs = state.tabs.filter(t => t.id === tab.id); state.activeTab = tab.id; renderTabs(); renderActive(); }),
                action('关闭全部标签', () => { state.tabs = []; state.activeTab = 'welcome'; renderTabs(); renderActive(); }),
                ...(tab.file ? [action('复制文件路径', () => copy(tab.file.path)), action('在文件管理器中显示', () => api.revealFile(tab.file.path))] : [])
            ]);
            select.addEventListener('auxclick', event => { if (event.button === 1) { event.preventDefault(); closeTab(tab.id); } });
            const close = button('×', () => closeTab(tab.id), 'tab-close');
            close.setAttribute('aria-label', '关闭 ' + tab.label);
            node.append(select, close);
            $('tabList').append(node);
        }
    }
    function renderActive() {
        const id = state.activeTab;
        document.querySelectorAll('#workbenchContent > .panel').forEach(node => node.classList.add('hidden'));
        const tab = state.tabs.find(t => t.id === id);
        if (tab?.file) {
            const file = tab.file;
            state.preview = file;
            $('previewPanel').classList.remove('hidden');
            $('filePreview').textContent = file.content || '';
            $('filePreview').classList.toggle('hidden', file.kind !== 'text');
            $('fileEmpty').classList.toggle('hidden', file.kind === 'text');
            $('fileEmptyTitle').textContent = file.kind === 'binary' ? '暂不支持预览二进制文件' : '文件超过 2 MB，暂不预览';
            $('addPreviewToPrompt').classList.toggle('hidden', file.kind !== 'text');
            $('breadcrumb').textContent = file.path.replaceAll('\\', '  ›  ').replaceAll('/', '  ›  ');
            $('breadcrumb').title = file.path;
            $('openProjectButton').textContent = '打开 ↗';
        }
        else {
            $((names[id] ? id : 'welcome') + 'Panel').classList.remove('hidden');
            $('breadcrumb').textContent = (basename(state.settings?.cwd) || '工作区') + '  ›  ' + (names[id] || '工作区');
            $('openProjectButton').textContent = '打开项目 ↗';
        }
    }
    function clearFiles() { clearFolderReferences(); state.tabs = state.tabs.filter(t => !t.file && t.id !== 'files'); state.preview = null; $('fileTree').replaceChildren(); if (!state.tabs.some(t => t.id === state.activeTab))
        state.activeTab = 'welcome'; renderTabs(); renderActive(); }
    async function browse() {
        if (!state.settings.cwd) {
            await chooseWorkspace();
            if (!state.settings.cwd)
                return;
        }
        openPanel('files');
        $('fileTree').replaceChildren();
        await fileTree($('fileTree'), await api.listDirectory());
    }
    async function fileTree(root, entries) {
        if (!entries.length) root.append(text('p', '此文件夹为空', 'sidebar-empty'));
        for (const entry of entries) {
            const wrap = text('div', '', 'file-entry');
            let loading = false;
            const node = button('', async () => {
                if (entry.type === 'directory') {
                    if (loading) return;
                    if (wrap.lastElementChild !== node) {
                        wrap.lastElementChild.classList.toggle('hidden');
                        node.setAttribute('aria-expanded', String(!wrap.lastElementChild.classList.contains('hidden')));
                        return;
                    }
                    const children = text('div', '', 'file-children');
                    loading = true; node.setAttribute('aria-busy', 'true');
                    try {
                        await fileTree(children, await api.listDirectory(entry.path));
                        wrap.append(children); node.setAttribute('aria-expanded', 'true');
                    } finally { loading = false; node.removeAttribute('aria-busy'); }
                }
                else {
                    const file = await api.readFile(entry.path);
                    file.kind = file.kind || 'text';
                    openPanel(file.path, entry.name);
                    state.tabs.find(t => t.id === file.path).file = file;
                    renderActive();
                }
            }, 'file-node');
            node.append(window.mydexIcon(entry.type === 'directory' ? 'folder' : 'file'), text('span', entry.name));
            node.title = entry.path;
            if (entry.type === 'directory') node.setAttribute('aria-expanded', 'false');
            menus.bind(node, () => [
                action(entry.type === 'directory' ? '展开 / 折叠文件夹' : '预览文件', () => node.click()),
                ...(entry.type === 'directory' ? [action('引用文件夹到任务', () => addFolderReference(entry.path), state.running || state.busy)] : []),
                action('复制路径', () => copy(entry.path)),
                action('在文件管理器中显示', () => api.revealFile(entry.path)),
                ...(entry.type === 'file' ? [action('添加到任务', async () => {
                    const file = await api.readFile(entry.path);
                    if (file.kind !== 'text') throw new Error('只能添加不超过 2 MB 的文本文件');
                    attachFile(file);
                }), action('使用系统应用打开…', () => api.openFile(entry.path))] : [])
            ]);
            wrap.append(node);
            root.append(wrap);
        }
    }
    function attach() {
        const file = state.preview;
        if (!file || file.kind !== 'text') {
            toast('请先预览一个文本文件');
            return;
        }
        attachFile(file);
    }
    function attachFile(file) {
        if (state.running || state.busy) { toast('请先停止当前任务'); return; }
        $('composer').value += ($('composer').value ? '\n\n' : '') + '文件：' + file.path + '\n\n\x60\x60\x60\n' + file.content + '\n\x60\x60\x60';
        autoSize();
        $('composer').focus();
        toast('文件已添加到任务');
    }
    async function git() { const result = await api.gitStatus(); renderDiff(result.status + '\n' + (result.diff || '\n无已跟踪文件差异'), true); openPanel('changes'); }
    function openSettings() {
        menus.close();
        const s = state.settings;
        if (!s)
            return;
        for (const [id, key] of [['apiBaseUrl', 'apiBaseUrl'], ['apiModel', 'model'], ['contextWindow', 'contextWindow'], ['sandboxSelect', 'sandbox'], ['approvalPolicy', 'approvalPolicy'], ['themeSelect', 'theme']])
            $(id).value = s[key] || '';
        $('apiKey').value = '';
        $('keyState').textContent = s.apiKeyConfigured ? '已加密保存' : '未配置';
        editProfile(s.activeProfileId);
        $('settingsModal').classList.remove('hidden');
        settingsPage('connection');
        $('fontSizeSelect').value = appearance.fontSize;
        $('densitySelect').value = appearance.density;
        $('apiBaseUrl').focus();
    }
    async function saveSettings() {
        if (anyRunning()) { toast('仍有对话运行中，请先停止这些任务再修改连接设置'); return; }
        ++modelRequest; models = []; renderModels(); $('refreshModels').disabled = false;
        if (!canNavigate())
            return;
        if (($('sandboxSelect').value === 'danger-full-access' || $('approvalPolicy').value === 'never') && !confirm('这会放宽文件访问或关闭部分审批。确认使用这些权限设置？'))
            return;
        const profile = { ...(editingProfileId ? { id: editingProfileId } : {}), name: $('profileName').value.trim(), apiBaseUrl: $('apiBaseUrl').value.trim(), model: $('apiModel').value.trim(), contextWindow: Number($('contextWindow').value), reasoningEffort: $('profileEffort').value, ...($('apiKey').value.trim() ? { apiKey: $('apiKey').value.trim() } : {}) };
        if (state.settings.connectionProfiles?.length) {
            state.busy = true; $('saveSettings').disabled = true; $('connectionSelect').disabled = true;
            try {
                await updateSettings({ sandbox: $('sandboxSelect').value, approvalPolicy: $('approvalPolicy').value, theme: $('themeSelect').value });
                await acceptConnection(await api.saveProfile(profile));
            } finally { state.busy = false; $('saveSettings').disabled = false; $('connectionSelect').disabled = false; }
        } else {
            await updateSettings({ apiBaseUrl: profile.apiBaseUrl, model: profile.model, contextWindow: profile.contextWindow, sandbox: $('sandboxSelect').value, approvalPolicy: $('approvalPolicy').value, theme: $('themeSelect').value, ...(profile.apiKey ? { apiKey: profile.apiKey } : {}) });
        }
        $('apiKey').value = '';
        appearance = { fontSize: $('fontSizeSelect').value, density: $('densitySelect').value };
        localStorage.setItem('myharness:appearance', JSON.stringify(appearance));
        applyAppearance();
        $('settingsModal').classList.add('hidden');
        if (!state.settings.connectionProfiles?.length) await restart();
        if (state.settings.apiKeyConfigured) void refreshModels();
        toast('设置已保存；真实服务连接将在发送任务时验证');
    }
    async function restart() { if (anyRunning()) { toast('仍有对话运行中，暂不能重启共享引擎'); return; } if (!canNavigate())
        return; status('正在重启', 'starting'); const value = await api.restartAgent(); state.threads = value.threads || []; renderThreads(); status('引擎已就绪'); if (state.threadId)
        await resume(state.threadId, false); }
    async function manage(action, name, targetId = state.threadId) {
        if (conversations.get(targetId)?.running) { toast('请先停止要操作的任务'); return; }
        menus.close();
        if (!targetId) {
            toast('请先打开一个任务');
            return;
        }
        if (!canNavigate())
            return;
        if (action === 'rename' && name === undefined) {
            renameTarget = targetId;
            $('renameInput').value = title(state.threads.find(t => t.id === targetId) || { name: targetId === state.threadId ? $('taskTitle').textContent : '' });
            $('renameModal').classList.remove('hidden');
            $('renameInput').focus();
            $('renameInput').select();
            return;
        }
        if (action === 'rename' && !name)
            return;
        if (action === 'export') {
            if (targetId !== state.threadId && !await resume(targetId)) return;
            const parts = [...$('messageList').querySelectorAll('.message')].map(node => (node.classList.contains('user') ? '## 用户\n\n' : '## Mydex\n\n') + (node.querySelector('.message-content')?.dataset.raw || node.querySelector('.message-body')?.dataset.raw || node.querySelector('.message-body')?.textContent || node.textContent));
            await api.exportTask($('taskTitle').textContent, '# ' + $('taskTitle').textContent + '\n\n' + parts.join('\n\n'));
            return;
        }
        if (action === 'archive' && !confirm('归档这个任务？记录将从当前列表隐藏，不会删除项目文件。')) return;
        state.busy = true; $('confirmRename').disabled = true;
        let result;
        try { result = await api.manageThread(action, targetId, name); }
        finally { state.busy = false; $('confirmRename').disabled = false; }
        if (action === 'rename' && targetId === state.threadId)
            $('taskTitle').textContent = name;
        if (action === 'rename' && conversations.has(targetId)) { conversations.get(targetId).title = name; renderConversationTabs(); }
        if (action === 'archive' && targetId === state.threadId)
            blank();
        if (action === 'fork' && result?.thread)
            await resume(result.thread.id);
        $('renameModal').classList.add('hidden');
        await refreshThreads();
    }
    function autoSize() { const node = $('composer'); node.style.height = 'auto'; node.style.height = Math.min(220, Math.max(72, node.scrollHeight)) + 'px'; }
    function toggleSidebar() { document.body.classList.toggle('sidebar-hidden'); }
    function bind(id, handler) { $(id).addEventListener('click', () => void guarded(handler)); }
    restoreLayout();
    api.onEvent(hostEvent);
    bind('newTaskButton', blank);
    bind('workspaceButton', chooseWorkspace);
    bind('refreshTasks', refreshThreads);
    bind('toggleSidebar', toggleSidebar);
    bind('goBack', () => navigateHistory(-1));
    bind('goForward', () => navigateHistory(1));
    bind('searchButton', () => { document.querySelector('.task-search').classList.toggle('hidden'); $('taskSearch').focus(); });
    $('taskSearch').oninput = renderThreads;
    bind('sendButton', send);
    bind('stopButton', stop);
    $('composer').oninput = autoSize;
    $('composer').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void guarded(send);
    } };
    for (const id of ['settingsButton', 'accountButton'])
        bind(id, openSettings);
    bind('permissionsButton', permissionMenu);
    bind('checkSandbox', checkSandbox);
    bind('setupSandbox', async () => {
        if (anyRunning()) { toast('请先停止所有对话，再设置沙箱'); return; }
        $('setupSandbox').disabled = true;
        try { const result = await api.setupSandbox(); if (result.started) $('sandboxStatus').textContent = '正在设置，请完成系统可能出现的管理员确认…'; else $('setupSandbox').disabled = false; }
        catch (error) { $('setupSandbox').disabled = false; throw error; }
    });
    bind('brandMenu', () => { const anchor = $('brandMenu'); if (menus.isOpen(anchor)) menus.close(true); else menus.show(anchor, [action('新对话', blank), action('添加项目…', chooseWorkspace), action('设置', openSettings), action('关于 Mydex', () => { openSettings(); settingsPage('about'); document.querySelector('[data-settings-page=about]').focus(); })]); });
    bind('refreshModels', refreshModels);
    bind('manageConnections', openSettings);
    $('connectionSelect').onchange = () => void guarded(() => switchConnection($('connectionSelect').value));
    $('profileSelect').onchange = () => { ++modelRequest; $('refreshModels').disabled = false; editProfile($('profileSelect').value); };
    bind('newProfile', () => { ++modelRequest; $('refreshModels').disabled = false; editProfile(null); $('profileName').focus(); });
    bind('deleteProfile', async () => {
        if (anyRunning() || !canNavigate()) { toast('请先停止所有任务'); return; }
        if (!editingProfileId || !confirm('删除这套 API 配置和它的本机密钥？对话历史会保留。')) return;
        state.busy = true;
        try { await acceptConnection(await api.deleteProfile(editingProfileId)); editProfile(state.settings.activeProfileId); toast('API 配置已删除'); }
        finally { state.busy = false; }
    });
    document.querySelectorAll('[data-settings-page]').forEach(node => node.onclick = () => settingsPage(node.dataset.settingsPage));
    for (const id of ['fontSizeSelect', 'densitySelect']) $(id).onchange = () => applyAppearance({ fontSize: $('fontSizeSelect').value, density: $('densitySelect').value });
    bind('resetLayoutButton', () => { document.documentElement.style.removeProperty('--sidebar-width'); document.documentElement.style.removeProperty('--chat-width'); document.body.classList.remove('sidebar-hidden'); document.querySelector('.agent-layout').classList.remove('inspector-hidden', 'workbench-maximized'); persistLayout(); toast('分栏布局已恢复'); });
    bind('closeSettings', closeSettings);
    bind('saveSettings', saveSettings);
    bind('restartAgentButton', restart);
    bind('clearKeyButton', async () => { if (!canNavigate())
        return; if (anyRunning()) { toast('仍有对话运行中，暂不能删除密钥'); return; } if (confirm('删除本机保存的 API Key？')) {
        if (state.settings.connectionProfiles?.length) {
            const p = state.settings.connectionProfiles.find(p => p.id === editingProfileId);
            if (!p) throw new Error('请先选择已保存的 API');
            await acceptConnection(await api.saveProfile({ ...p, clearKey: true }));
        } else { await updateSettings({ apiKey: '' }); await restart(); }
        openSettings();
    } });
    $('effortSelect').onchange = () => void guarded(async () => { if (!canNavigate())
        return; const old = state.settings.reasoningEffort; await updateSettings({ reasoningEffort: $('effortSelect').value }); if (old === 'none' || state.settings.reasoningEffort === 'none')
        await restart(); });
    $('modelSelect').onchange = () => void guarded(async () => {
        const value = $('modelSelect').value;
        if (!value) { renderModels(); openSettings(); $('apiModel').focus(); return; }
        if (!canNavigate()) { renderModels(); return; }
        state.busy = true; $('modelSelect').disabled = true;
        try { await updateSettings({ model: value }); toast('已选择模型：' + value); }
        finally { state.busy = false; $('modelSelect').disabled = false; renderModels(); }
    });
    menus.bind($('modelSelect'), () => [action('刷新模型列表', refreshModels), action('手动配置模型…', openSettings)]);
    for (const id of ['filesButton', 'browseFiles', 'newTab', 'reloadFiles'])
        bind(id, browse);
    $('attachPreviewButton').title = '添加文件或文件夹引用';
    $('attachPreviewButton').setAttribute('aria-label', '添加文件或文件夹引用');
    $('attachPreviewButton').setAttribute('aria-haspopup', 'menu');
    bind('attachPreviewButton', () => {
        const anchor = $('attachPreviewButton');
        if (menus.isOpen(anchor)) { menus.close(true); return; }
        menus.show(anchor, [action('浏览项目文件', browse),
            action('引用文件夹…', () => addFolderReference(), state.running || state.busy),
            action('引用当前项目文件夹', () => addFolderReference(state.settings.cwd), !state.settings.cwd || state.running || state.busy)]);
    });
    bind('addPreviewToPrompt', attach);
    bind('gitButton', git);
    bind('showActivity', () => openPanel('activity'));
    bind('openProjectButton', () => { const file = state.tabs.find(t => t.id === state.activeTab)?.file; return file ? api.openFile(file.path) : api.openWorkspace(); });
    bind('copyPath', async () => { const file = state.tabs.find(t => t.id === state.activeTab)?.file; await navigator.clipboard.writeText(file?.path || state.settings.cwd || ''); toast('路径已复制'); });
    for (const id of ['toggleInspector', 'closeWorkbench'])
        bind(id, () => document.querySelector('.agent-layout').classList.toggle('inspector-hidden'));
    bind('maximizeWorkbench', () => document.querySelector('.agent-layout').classList.toggle('workbench-maximized'));
    bind('exportButton', () => manage('export'));
    $('taskMore').setAttribute('aria-haspopup', 'menu');
    bind('taskMore', () => { if (menus.isOpen($('taskMore'))) menus.close(true); else if (state.threadId) menus.show($('taskMore'), taskActions(state.threadId)); else toast('请先打开一个任务'); });
    bind('cancelRename', () => $('renameModal').classList.add('hidden'));
    bind('confirmRename', () => manage('rename', $('renameInput').value.trim(), renameTarget));
    $('renameInput').onkeydown = event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); $('confirmRename').click(); } };
    bind('terminalButton', () => $('terminalPanel').classList.toggle('hidden'));
    bind('closeTerminal', () => $('terminalPanel').classList.add('hidden'));
    bind('stopCommandButton', () => api.stopCommand());
    $('terminalForm').onsubmit = event => { event.preventDefault(); void guarded(async () => { if (await api.runCommand($('terminalInput').value))
        $('terminalInput').value = ''; }); };
    document.querySelectorAll('[data-menu]').forEach(node => node.onclick = () => void guarded(() => api.menu(node.dataset.menu)));
    document.querySelectorAll('[data-panel]').forEach(node => node.onclick = () => openPanel(node.dataset.panel));
    document.querySelectorAll('[data-suggestion]').forEach(node => node.onclick = () => { $('composer').value = node.dataset.suggestion; autoSize(); $('composer').focus(); });
    resizeHandle('sidebarResize', '--sidebar-width', 200, () => Math.min(450, innerWidth - 730), () => 0);
    resizeHandle('chatResize', '--chat-width', 340, () => innerWidth - document.querySelector('.sidebar').getBoundingClientRect().width - 300, () => document.querySelector('.conversation-column').getBoundingClientRect().left);
    window.addEventListener('keydown', event => {
        // Global navigation shortcuts must not discard a dialog's unsaved input.
        if (document.querySelector('.modal-backdrop:not(.hidden)') && (event.ctrlKey || event.metaKey) && ['n', 'k', ','].includes(event.key.toLowerCase())) { event.preventDefault(); return; }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
            event.preventDefault();
            blank();
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            document.querySelector('.task-search').classList.remove('hidden');
            $('taskSearch').focus();
        }
        if ((event.ctrlKey || event.metaKey) && event.key === ',') {
            event.preventDefault();
            openSettings();
        }
        if (event.key === 'Escape') {
            menus.close(true);
            if (!$('settingsModal').classList.contains('hidden')) closeSettings();
            for (const id of ['settingsModal', 'renameModal', 'taskMenu'])
                $(id).classList.add('hidden');
            $('apiKey').value = '';
            if (document.activeElement === $('taskSearch')) {
                $('taskSearch').value = '';
                renderThreads();
                document.querySelector('.task-search').classList.add('hidden');
            }
        }
        const modal = document.querySelector('.modal-backdrop:not(.hidden)');
        if (event.key === 'Tab' && modal) {
            const focusable = [...modal.querySelectorAll('button,input,select')].filter(n => !n.disabled && n.getClientRects().length);
            const first = focusable[0], last = focusable.at(-1);
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            }
            else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    });
    void guarded(async () => { const initial = await api.getState(); state.settings = initial.settings; state.threads = initial.agentState.threads || []; applySettings(); renderThreads(); renderActive(); if (initial.agentState.error) {
        status('引擎启动失败', 'stopped');
        toast(initial.agentState.error, true);
    }
    else
        status('引擎就绪 · ' + (state.settings.apiKeyConfigured ? 'API 已配置' : '请配置 API'));
        conversation(); renderConversationTabs(); await refreshPermissions();
        if (state.settings.apiKeyConfigured) void refreshModels(); });
}());

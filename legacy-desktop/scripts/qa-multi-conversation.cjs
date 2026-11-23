const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const out = path.join(__dirname, '..', 'qa-artifacts');
app.setPath('userData', fs.mkdtempSync(path.join(out, 'multi-'))); app.disableHardwareAcceleration();
for (const stream of [process.stdout, process.stderr]) stream.on('error', () => {});
const settings = {cwd:'D:\\Projects\\A',projects:['D:\\Projects\\A','D:\\Projects\\B'],model:'gpt-5.6-sol',reasoningEffort:'medium',apiKeyConfigured:true,apiBaseUrl:'https://example.invalid/v1',theme:'light',sandbox:'workspace-write',approvalPolicy:'on-request',contextWindow:32768};
const threads = ['A','B'].map(id => ({ id, name:'任务 '+id, cwd:'D:\\Projects\\'+id, turns:[], updatedAt:Date.now()/1000 }));
const calls=[]; let win;
const permissions=new Map();
function emit(threadId,method,params={}) { win.webContents.send('qa-event','agent-notification',{method,params:{threadId,...params}}); }
ipcMain.handle('qa',async (_,method,args) => {
  calls.push({method,args});
  if(method==='getPermissions') return permissions.get(args[0]) || {sandbox:'workspace-write',approvalPolicy:'on-request'};
  if(method==='setPermissions') { const p={sandbox:args[1]==='readOnly'?'read-only':'workspace-write',approvalPolicy:'on-request'};permissions.set(args[0],p);return p; }
  if(method==='getState') return {settings,agentState:{threads}};
  if(method==='listModels') return ['gpt-5.6-sol','a-very-long-model-id-that-must-not-widen-the-current-selection'];
  if(method==='listThreads') return threads;
  if(method==='resumeThread') { const t=threads.find(t=>t.id===args[0]); settings.cwd=t.cwd;return t; }
  if(method==='updateSettings') return Object.assign(settings,args[0]);
  if(method==='referenceFolder') return {path:settings.cwd,workspace:settings.cwd,relativePath:'.'};
  if(method==='startTurn'){ emit(args[0],'turn/started',{turn:{id:'turn-'+args[0]}});return{id:'turn-'+args[0]}; }
  if(method==='interruptTurn'){emit(args[0],'turn/completed',{turn:{id:args[1],status:'interrupted'}});return true;}
  return true;
});
app.whenReady().then(async()=>{
  try {
    win = new BrowserWindow({show:false,width:1400,height:950,webPreferences:{preload:path.join(__dirname,'qa-ui-preload.cjs'),contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
    const run = code => win.webContents.executeJavaScript(code);
    const wait=()=>new Promise(resolve=>setTimeout(resolve,150));
    const click=async selector=>{await run(`document.querySelector(${JSON.stringify(selector)}).click()`);await wait();};
    const type=async value=>run(`document.getElementById('composer').value=${JSON.stringify(value)}`);
    const chat=()=>run("document.getElementById('messageList').textContent");
    await win.loadFile(process.argv[2]?path.resolve(process.argv[2]):path.join(__dirname,'..','renderer','index.html'));await wait();
    assert.equal(await run("getComputedStyle(document.getElementById('modelSelect')).fontSize"),'14px');
    assert.equal(await run("getComputedStyle(document.getElementById('effortSelect')).fontSize"),'14px');
    assert.ok(await run("document.getElementById('modelSelect').getBoundingClientRect().width<150"));
    const toolbar=await run("(()=>{const r=document.querySelector('.composer-toolbar').getBoundingClientRect();return{x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()");
    fs.writeFileSync(path.join(out,'1.2.0-toolbar.png'),(await win.webContents.capturePage(toolbar)).toPNG());
    await click('[data-thread-id="A"]');await click('#permissionsButton');
    fs.writeFileSync(path.join(out,'1.2.0-permissions.png'),(await win.webContents.capturePage()).toPNG());
    assert.equal(await run("[...document.querySelectorAll('#taskMenu button')].find(b=>b.textContent.startsWith('自动审查')).disabled"),true);
    await run("[...document.querySelectorAll('#taskMenu button')].find(b=>b.textContent.startsWith('只读')).click()");await wait();
    assert.equal(await run("document.getElementById('permissionsButton').dataset.mode"),'readOnly');
    await type('执行 A');await click('#sendButton');
    assert.equal(await run("document.getElementById('permissionsButton').disabled"),true);
    emit('A','item/agentMessage/delta',{itemId:'a-message',delta:'Alpha 1'});await wait();
    assert.equal(await run("document.getElementById('newTaskButton').disabled"),false);
    await click('#newTaskButton');await type('独立的新对话草稿');
    const draftKey=await run("document.querySelector('#conversationTabs [aria-selected=true]').dataset.conversation");
    await click('[data-thread-id="B"]');await type('执行 B');await click('#sendButton');
    assert.equal(await run("document.getElementById('permissionsButton').dataset.mode"),'approval');
    emit('A','item/agentMessage/delta',{itemId:'a-message',delta:' + Alpha 2'});
    emit('B','item/agentMessage/delta',{itemId:'b-message',delta:'Beta only'});
    win.webContents.send('qa-event','agent-request',{id:77,method:'item/commandExecution/requestApproval',params:{threadId:'A',command:'Write-Output test'}});
    await wait(); assert.ok((await chat()).includes('Beta only'));assert.ok(!(await chat()).includes('Alpha'));
    await click('[data-conversation="A"]');
    assert.ok((await chat()).includes('Alpha 1 + Alpha 2'));assert.ok(!(await chat()).includes('Beta'));
    assert.equal(await run("document.querySelector('.approval-card').dataset.requestId"),'77');
    await run("[...document.querySelectorAll('.approval-card button')].find(b=>b.textContent==='本次允许').click()");await wait();
    assert.equal(calls.filter(c=>c.method==='approve').at(-1).args[0],77);
    win.webContents.send('qa-event','agent-request',{id:78,method:'item/permissions/requestApproval',params:{threadId:'A',turnId:'turn-A',permissions:{network:{enabled:true},fileSystem:{read:['D:\\shared'],write:null}}}});
    await wait();assert.ok(await run("document.querySelector('.approval-card').textContent.includes('D:\\\\shared')"));
    await run("[...document.querySelectorAll('.approval-card button')].find(b=>b.textContent==='本轮允许').click()");await wait();
    assert.deepEqual(calls.filter(c=>c.method==='grantPermissions').at(-1).args,[78,true,'turn']);
    win.webContents.send('qa-event','agent-request',{id:79,method:'item/commandExecution/requestApproval',params:{threadId:'A',networkApprovalContext:{host:'example.invalid',protocol:'https'},availableDecisions:['decline','accept']}});
    await wait();assert.equal(await run("document.querySelectorAll('.approval-card button').length"),2);
    assert.ok(await run("document.querySelector('.approval-card').textContent.includes('https://example.invalid')"));
    emit('A','serverRequest/resolved',{requestId:79});await wait();assert.equal(await run("document.querySelectorAll('.approval-card').length"),0);
    await click('#stopButton'); assert.deepEqual(calls.filter(c=>c.method==='interruptTurn').at(-1).args,['A','turn-A']);
    await type('A 的草稿');await click('#attachPreviewButton');
    await run("[...document.querySelectorAll('#taskMenu button')].find(b=>b.textContent==='引用当前项目文件夹').click()");await wait();
    await click('[data-conversation="B"]'); assert.ok((await chat()).includes('Beta only'));
    assert.equal(await run("document.getElementById('composer').disabled"),true);
    await click('[data-conversation="'+draftKey+'"]');
    assert.equal(await run("document.getElementById('composer').value"),'独立的新对话草稿');
    await click('#settingsButton');await click('#restartAgentButton');
    assert.equal(calls.filter(c=>c.method==='restartAgent').length,0);await click('#closeSettings');
    // Closing a tab does not interrupt the background task; it can be reopened from the sidebar.
    await click('[data-conversation="B"]');await click('.conversation-tab.active>button:last-child');
    assert.equal(calls.filter(c=>c.method==='interruptTurn').length,1);
    emit('B','item/agentMessage/delta',{itemId:'b-message',delta:' + done'});
    emit('B','turn/completed',{turn:{id:'turn-B',status:'completed'}});await wait();
    await click('[data-thread-id="B"]');assert.ok((await chat()).includes('Beta only + done'));
    await type('B 的草稿');await click('[data-conversation="A"]');
    assert.equal(await run("document.getElementById('composer').value"),'A 的草稿');
    assert.equal(await run("document.querySelector('#folderReferences .folder-reference').title"),'D:\\Projects\\A');
    await click('[data-conversation="B"]');assert.equal(await run("document.getElementById('composer').value"),'B 的草稿');
    assert.equal(await run("document.querySelectorAll('#folderReferences .folder-reference').length"),0);
    win.setSize(1040,680);await wait();
    assert.ok(await run("document.querySelector('.composer-toolbar').scrollWidth<=document.querySelector('.composer-toolbar').clientWidth"));
    fs.writeFileSync(path.join(out,'1.2.0-multi-conversation.png'),(await win.webContents.capturePage()).toPNG());
    console.log('PASS multi: concurrent A/B, new draft during run, isolated streams/drafts/folders/projects, background approval, targeted stop, close/reopen live task, completion replay, restart protection, compact toolbar font/width.');app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});

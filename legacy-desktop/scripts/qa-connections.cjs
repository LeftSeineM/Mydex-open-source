const {app,BrowserWindow,nativeTheme}=require('electron');
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const root=fs.mkdtempSync(path.join(__dirname,'..','qa-artifacts','connections-'));
const profile=path.join(root,'profile'),workspace=path.join(root,'project');
fs.mkdirSync(profile);fs.mkdirSync(workspace);
app.disableHardwareAcceleration();
process.env.MY_HARNESS_DATA_DIR=profile;
process.env.MY_HARNESS_ENGINE_HOME=path.join(root,'engine');
const requests=[],servers=[];let held,win;
for(const stream of [process.stdout,process.stderr])stream.on('error',()=>{});
const timeout=setTimeout(()=>{console.error('FAIL connection QA timeout');app.exit(1)},90000);
async function endpoint(name){
  const server=http.createServer(async(req,res)=>{
    const authorization=req.headers.authorization;
    if(req.url==='/v1/models'){
      assert.equal(authorization,'Bearer qa-key-'+name);
      res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{id:'qa-'+name+'-model'}]}));return;
    }
    if(req.url!=='/v1/responses'){res.writeHead(404).end();return;}
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);requests.push({name,authorization,body});
    const finish=()=>{
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
      const send=(type,data)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');
      const id='resp_'+requests.length,text='QA_REPLY_'+name;
      const item={type:'message',id:'msg_'+requests.length,role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};
      send('response.created',{response:{id,object:'response',status:'in_progress',output:[]}});
      send('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});
      send('response.content_part.added',{item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});
      send('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:text});
      send('response.output_text.done',{item_id:item.id,output_index:0,content_index:0,text});
      send('response.output_item.done',{output_index:0,item});
      send('response.completed',{response:{id,object:'response',status:'completed',output:[item],usage:{input_tokens:10,output_tokens:5,total_tokens:15}}});res.end();
    };
    if(JSON.stringify(body.input).includes('HOLD_SWITCH'))held=finish;else finish();
  });
  servers.push(server);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return 'http://127.0.0.1:'+server.address().port+'/v1';
}
(async()=>{
  const a=await endpoint('A'),b=await endpoint('B');
  fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({cwd:workspace,projects:[workspace],apiBaseUrl:a,model:'qa-A-model',reasoningEffort:'none',theme:'light'}));
  require('../dist/main');await app.whenReady();
  try{
    for(let i=0;i<120;i++){
      win=BrowserWindow.getAllWindows()[0];
      if(win&&!win.webContents.isLoading()&&await win.webContents.executeJavaScript('!!document.querySelector("#connectionSelect option")'))break;
      await new Promise(r=>setTimeout(r,100));
    }
    win.hide();
    const run=code=>win.webContents.executeJavaScript(code);
    const invoke=(method,...args)=>run('myHarness.'+method+'(...'+JSON.stringify(args)+')');
    const delay=()=>new Promise(r=>setTimeout(r,80));
    async function until(check){for(let i=0;i<150;i++){if(await check())return;await delay();}throw new Error('Condition timed out');}
    const {SettingsStore}=require('../dist/settingsStore');
    const store=new SettingsStore();let migrated=await store.load();
    assert.equal(migrated.activeProfileId,'default');assert.equal(migrated.model,'qa-A-model');
    await invoke('updateSettings',{apiKey:'qa-key-A'});
    const savedA=(await invoke('getState')).settings;
    assert.equal(savedA.connectionProfiles.length,1);assert.equal(savedA.apiKeyConfigured,true);
    const resultB=await invoke('saveProfile',{name:'线路 B',apiBaseUrl:b,model:'qa-B-model',contextWindow:64000,reasoningEffort:'none',apiKey:'qa-key-B'});
    const idB=resultB.settings.activeProfileId;assert.notEqual(idB,'default');
    assert.equal(resultB.settings.connectionProfiles.length,2);
    assert.equal(JSON.stringify(resultB).includes('qa-key-'),false);
    assert.deepEqual(await invoke('listModels','default'),['qa-A-model']);
    assert.deepEqual(await invoke('listModels',idB),['qa-B-model']);
    await invoke('saveProfile',{...resultB.settings.connectionProfiles.find(p=>p.id===idB),name:'备用线路 B'});
    const loaded=new SettingsStore();await loaded.load();
    assert.equal(await loaded.readApiKey('default'),'qa-key-A');assert.equal(await loaded.readApiKey(idB),'qa-key-B');
    const disk=fs.readFileSync(path.join(profile,'settings.json'),'utf8');assert.ok(!disk.includes('qa-key-'));
    assert.ok(!fs.readFileSync(path.join(profile,'connection-keys',idB+'.enc')).includes(Buffer.from('qa-key-B')));
    await assert.rejects(()=>invoke('saveProfile',{name:'bad',apiBaseUrl:'http://example.com/v1',contextWindow:32768}),/HTTPS/);
    await assert.rejects(()=>invoke('saveProfile',{id:'../../bad',name:'bad',apiBaseUrl:a}),/ID/);
    await assert.rejects(()=>invoke('activateProfile','missing'),/未找到/);
    // Exercise the actual homepage switch control, then real engine routes.
    await run('document.getElementById("connectionSelect").value="default";document.getElementById("connectionSelect").dispatchEvent(new Event("change"))');
    await until(async()=>!(await run('document.getElementById("connectionSelect").disabled'))&&(await invoke('getState')).settings.activeProfileId==='default');
    const events=[];win.webContents.on('ipc-message',()=>{});
    await run('window.qaEvents=[];myHarness.onEvent(e=>window.qaEvents.push(e));void 0');
    const {MydexAppServer}=require('../dist/mydexAppServer');
    // This test checks transport and switching, not machine sandbox setup.
    const originalReadiness=MydexAppServer.prototype.sandboxReadiness;
    MydexAppServer.prototype.sandboxReadiness=async()=>({status:'ready'});
    const thread=await invoke('newThread');
    const completed=async id=>until(()=>run('qaEvents.some(e=>e.channel==="agent-notification"&&e.payload.method==="turn/completed"&&e.payload.params.threadId==='+JSON.stringify(thread.id)+'&&e.payload.params.turn.id==='+JSON.stringify(id)+')'));
    let turn=await invoke('startTurn',thread.id,'FIRST_ROUTE_A',[]);await completed(turn.id);
    assert.equal(requests.at(-1).name,'A');assert.equal(requests.at(-1).authorization,'Bearer qa-key-A');assert.equal(requests.at(-1).body.model,'qa-A-model');
    await invoke('activateProfile',idB);
    turn=await invoke('startTurn',thread.id,'CONTINUE_ROUTE_B',[]);await completed(turn.id);
    assert.equal(requests.at(-1).name,'B');assert.equal(requests.at(-1).authorization,'Bearer qa-key-B');assert.equal(requests.at(-1).body.model,'qa-B-model');
    assert.ok(JSON.stringify(requests.at(-1).body.input).includes('FIRST_ROUTE_A'));
    assert.ok(requests.at(-1).body.tools.some(t=>t.name==='apply_patch'&&t.type==='custom'));
    turn=await invoke('startTurn',thread.id,'HOLD_SWITCH',[]);await until(()=>Boolean(held));
    await assert.rejects(()=>invoke('activateProfile','default'),/仍有对话/);
    await assert.rejects(()=>invoke('deleteProfile',idB),/仍有对话/);
    held();await completed(turn.id);
    MydexAppServer.prototype.sandboxReadiness=originalReadiness;
    await invoke('activateProfile','default');
    // Visible settings editor can add and save a third configuration.
    await run('document.getElementById("manageConnections").click()');await delay();
    await run('document.getElementById("newProfile").click()');
    await run('document.getElementById("profileName").value="手动新增测试";document.getElementById("apiBaseUrl").value='+JSON.stringify(b)+';document.getElementById("apiModel").value="qa-B-model";document.getElementById("saveSettings").click()');
    await until(()=>run('document.getElementById("settingsModal").classList.contains("hidden")'));
    const third=(await invoke('getState')).settings;assert.equal(third.connectionProfiles.length,3);assert.equal(third.apiKeyConfigured,false);
    assert.equal((await loaded.load()).activeProfileId,third.activeProfileId);
    await invoke('deleteProfile',third.activeProfileId);await invoke('deleteProfile',idB);
    assert.equal(fs.existsSync(path.join(profile,'connection-keys',idB+'.enc')),false);
    await assert.rejects(()=>invoke('deleteProfile','default'),/至少保留/);
    const screenshot=path.join(root,'multi-api-settings.png');
    await run('document.querySelectorAll(".toast").forEach(n=>n.remove())');
    await run('document.getElementById("manageConnections").click()');await delay();
    win.showInactive();await delay();
    fs.writeFileSync(screenshot,(await win.webContents.capturePage()).toPNG());
    nativeTheme.themeSource='dark';await delay();fs.writeFileSync(path.join(root,'multi-api-dark.png'),(await win.webContents.capturePage()).toPNG());
    await run('document.getElementById("closeSettings").click()');await delay();fs.writeFileSync(path.join(root,'multi-api-home.png'),(await win.webContents.capturePage()).toPNG());
    const result={passed:true,version:require('../package.json').version,requests:requests.map(r=>({route:r.name,model:r.body.model})),checks:['legacy migration','separate encrypted keys','blank keeps existing key','model discovery by profile','URL and ID validation','homepage switch','real Responses routes A/B','same conversation resumes after switch','native patch capability','reject switch/delete while running','settings add/save','no key inheritance','restart persistence','delete key and keep history','last-profile guard'],screenshot};
    fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2));console.log('PASS multi API',JSON.stringify(result));
    app.exit(0);
  }catch(error){console.error(error);app.exit(1)}finally{clearTimeout(timeout);servers.forEach(s=>s.close());}
})().catch(error=>{console.error(error);app.exit(1)});


const {app,BrowserWindow,Tray}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=fs.mkdtempSync(path.join(__dirname,'..','qa-artifacts','tray-'));
process.env.MY_HARNESS_DATA_DIR=path.join(root,'profile');
process.env.MY_HARNESS_ENGINE_HOME=path.join(root,'engine');
app.disableHardwareAcceleration();
let tray,menu,tooltip;
const originalTooltip=Tray.prototype.setToolTip;
Tray.prototype.setToolTip=function(value){tooltip=value;return originalTooltip.call(this,value)};
const original=Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu=function(value){tray=this;menu=value;return original.call(this,value)};
for(const stream of [process.stdout,process.stderr])stream.on('error',()=>{});
const timeout=setTimeout(()=>{console.error('tray QA timeout');app.exit(1)},30000);
require('../dist/main');
app.whenReady().then(async()=>{
  try{
    for(let i=0;i<100&&!menu;i++)await new Promise(r=>setTimeout(r,100));
    assert.ok(tray&&!tray.isDestroyed());
    assert.equal(tooltip,'Mydex · 多 API 工作台');
    const win=BrowserWindow.getAllWindows()[0];
    assert.ok(menu.items.some(item=>item.label==='打开安装目录'));
    assert.ok(menu.items.some(item=>item.label==='打开配置目录'));
    win.close();assert.equal(win.isDestroyed(),false);assert.equal(win.isVisible(),false);
    menu.items.find(item=>item.label==='打开 Mydex').click();assert.equal(win.isVisible(),true);
    win.hide();tray.emit('click');assert.equal(win.isVisible(),true);
    await new Promise(r=>setTimeout(r,300));
    menu.items.find(item=>item.label==='API 配置管理…').click();
    await new Promise(r=>setTimeout(r,100));
    assert.equal(await win.webContents.executeJavaScript('document.getElementById("settingsModal").classList.contains("hidden")'),false);
    app.once('will-quit',()=>{
      try{
        assert.equal(tray.isDestroyed(),true);
        const result={passed:true,checks:['native tray exists','tooltip','restore menu','close hides and keeps process','tray click restores','API settings menu','install and data directory menu','explicit exit destroys tray']};
        fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(result,null,2));console.log('PASS tray',JSON.stringify(result));
      }catch(error){console.error(error);process.exitCode=1}
      clearTimeout(timeout);
    });
    menu.items.find(item=>item.label==='完全退出 Mydex').click();
  }catch(error){console.error(error);clearTimeout(timeout);app.exit(1)}
});

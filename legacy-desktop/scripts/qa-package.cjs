const fs = require('fs'); const path = require('path'); const { spawn } = require('child_process'); const assert = require('assert/strict');
const root = path.join(__dirname, '..');
const work = fs.mkdtempSync(path.join(root, 'qa-artifacts', 'package-'));
const exe = process.argv[2] || path.join(root, 'release', 'win-unpacked', 'Mydex.exe');
const screenshot = path.join(work, 'startup.png');
const child = spawn(exe, [], { windowsHide:true, env:{ ...process.env, MY_HARNESS_SCREENSHOT:screenshot, MY_HARNESS_DATA_DIR:path.join(work,'profile'), MY_HARNESS_ENGINE_HOME:path.join(work,'engine') }, stdio:['ignore','pipe','pipe'] });
let log=''; child.stdout.on('data', data=>log+=data); child.stderr.on('data', data=>log+=data);
const timeout=setTimeout(()=>{ child.kill(); console.error('Packaged app timeout',log); process.exitCode=1; },60000);
child.on('error',error=>{clearTimeout(timeout);console.error(error);process.exitCode=1;});
child.on('close',code=>{
  clearTimeout(timeout);
  try {
    assert.equal(code,0,log);
    const state=JSON.parse(fs.readFileSync(screenshot+'.json','utf8'));
    assert.equal(state.version,require('../package.json').version); assert.equal(state.engine,'api'); assert.equal(state.websiteApiPresent,false); assert.equal(state.errors.length,0,JSON.stringify(state));
    assert.ok(fs.statSync(screenshot).size>10000);
    console.log('PASS packaged EXE: native launch, trusted IPC, bundled core initialize, UI rendered, clean exit',JSON.stringify(state));
    console.log('SCREENSHOT',screenshot);
  } catch(error) {console.error(error);process.exitCode=1;}
});

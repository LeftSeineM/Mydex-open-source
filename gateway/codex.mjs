import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {EventEmitter} from 'node:events';
import {resolveCodexExecutable} from './codex-path.mjs';

// This runs on the PC only. The installed Codex owns configuration, models and tools.
export class Codex extends EventEmitter {
  seq = 0; pending = new Map(); process = null; ready = null;
  constructor(executable, cwd) { super(); this.executable = executable; this.cwd = cwd; }
  async start() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      this.executable = resolveCodexExecutable(this.executable);
      this.process = spawn(this.executable, ['app-server','--listen','stdio://'], {cwd:this.cwd, windowsHide:true, stdio:['pipe','pipe','pipe']});
      readline.createInterface({input:this.process.stdout}).on('line', line => {
        let m; try { m = JSON.parse(line); } catch { return; }
        if (m.method) this.emit('event', m);
        else if (this.pending.has(m.id)) {
          const p = this.pending.get(m.id); this.pending.delete(m.id); clearTimeout(p.timer);
          m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
        }
      });
      // Do not forward arbitrary stderr; it could contain provider credentials.
      this.process.stderr.resume();
      this.process.on('error', e => this.fail(e));
      this.process.on('exit', () => this.fail(new Error('Codex 进程已退出')));
      await this.request('initialize', {clientInfo:{name:'mydex_mobile_gateway',title:'Mydex',version:'0.1.0'},capabilities:{experimentalApi:true}});
      this.write({method:'initialized',params:{}});
    })().catch(e => { this.ready = null; throw e; });
    return this.ready;
  }
  fail(e) {
    this.ready = null; this.process = null;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(e); }
    this.pending.clear(); this.emit('offline');
  }
  write(m) { if (!this.process?.stdin.writable) throw new Error('Codex 未连接'); this.process.stdin.write(JSON.stringify(m)+'\n'); }
  request(method, params) {
    return new Promise((resolve,reject) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Codex 响应超时，请先核对任务状态再重试')); }, 30000);
      this.pending.set(id,{resolve,reject,timer});
      try { this.write({id,method,params}); } catch(e) {clearTimeout(timer);this.pending.delete(id);reject(e);}
    });
  }
  respond(id, result) { this.write({id,result}); }
}

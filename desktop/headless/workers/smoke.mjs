// Manual smoke test against a real DeepSeek Harness install (not part of `node --test`).
// Usage: node workers/smoke.mjs <emptyDataDir> [tier]
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WorkerEngine} from './engine.mjs';

const [dir,tier='light']=process.argv.slice(2);
if(!dir)throw Error('Usage: node workers/smoke.mjs <emptyDataDir> [tier]');
const e=new WorkerEngine({dir:path.resolve(dir)});
console.log('dshAvailable',e.tiers().dshAvailable);
const target=fileURLToPath(new URL('./engine.mjs',import.meta.url));
const r=e.dispatch({title:'统计 engine.mjs',tier,why:'数数的体力活',brief:`- 负责什么：用命令统计 ${target} 的物理行数（空行也算），以及包含 \`fail(\` 的行数。必须实际运行命令。\n- 不能碰什么：不修改任何文件。\n- 怎样算完成：两个数字，附命令和输出。`});
console.log('dispatched',r.id,r.model);
const [x]=await e.wait({ids:[r.id],timeoutSeconds:280});
console.log(x.state,'¥'+x.costCny,x.error||'');
console.log(x.receiptText||'');

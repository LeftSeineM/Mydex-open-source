import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {definitions} from '../../gateway/tool-registry.mjs';
const data=process.env.MYDEX_DATA_DIR||path.join(os.homedir(),'Library','Application Support','Mydex');
fs.mkdirSync(data,{recursive:true,mode:0o700});
process.env.MYDEX_DATA_DIR=data;
for(const [id,dir] of [['claude-desktop','Library/Application Support/Claude'],['zcode','Library/Application Support/ZCode']])definitions.find(d=>d.id===id)?.dirs.push(dir);
await import('../gui-bridge.mjs');

// Read-only local workbench for Router-owned Workers: task tree, briefs, receipts, ledger.
// Usage: node workers/workbench.mjs [workersDataDir] [port]   then open http://127.0.0.1:4317
// Defaults to <MYDEX_DATA_DIR or app data>/workers. Binds to loopback only and never writes.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dataRoot} from '../local-state.mjs';
import {workerBoard, workerJob} from '../../../gateway/worker-board.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HANDOFF = path.resolve(process.argv[2] || path.join(dataRoot, 'workers'));
const PORT = Number(process.argv[3] || 4317);
const state = () => workerBoard(HANDOFF);
const job = id => workerJob(HANDOFF, id);

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, {'Content-Type': type, 'Cache-Control': 'no-store'}); res.end(body); };
  try {
    if (url.pathname === '/') return send(200, fs.readFileSync(path.join(HERE, 'ui', 'index.html')), 'text/html; charset=utf-8');
    if (url.pathname === '/api/state') return send(200, JSON.stringify(state()));
    const m = url.pathname.match(/^\/api\/job\/([^/]+)$/);
    if (m) { const j = job(m[1]); return j ? send(200, JSON.stringify(j)) : send(404, '{"error":"not found"}'); }
    send(404, 'not found', 'text/plain');
  } catch (e) { send(500, JSON.stringify({error: e.message})); }
}).listen(PORT, '127.0.0.1', () => console.log(`workbench: http://127.0.0.1:${PORT}  (handoff: ${HANDOFF})`));

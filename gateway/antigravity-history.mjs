import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const validId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const prefix = 'tool:agy:';

function workspacePath(value) {
  try {
    const uris = JSON.parse(value);
    if (!Array.isArray(uris)) return '';
    for (const uri of uris) {
      if (typeof uri !== 'string' || !uri.startsWith('file:///')) continue;
      try { return fileURLToPath(uri); } catch {}
    }
  } catch {}
  return '';
}

function task(row) {
  const cwd = workspacePath(row.workspace_uris);
  const workspaceKey = process.platform === 'win32' ? cwd.toLowerCase() : cwd;
  const projectId = cwd ? 'agy:' + crypto.createHash('sha256').update(workspaceKey).digest('hex').slice(0,16) : null;
  return {
    id: prefix + row.conversation_id,
    toolId: 'agy',
    title: row.title.trim().slice(0,120) || 'Antigravity 会话',
    updatedAt: Date.parse(row.last_modified_time) || 0,
    status: 'Completed',
    cwd, projectId, source: 'history', readOnly: true, canApprove: false, approvals: []
  };
}

export class AntigravityHistory {
  constructor(home) {
    this.file = path.join(home,'.gemini/antigravity/conversation_summaries.db');
  }

  read(callback, fallback) {
    let db;
    try {
      const stat = fs.lstatSync(this.file);
      if (!stat.isFile()) return fallback;
      const { DatabaseSync } = require('node:sqlite');
      db = new DatabaseSync(this.file, { readOnly:true });
      return callback(db);
    } catch { return fallback; }
    finally { db?.close(); }
  }

  list() {
    return this.read(db => {
      const rows = db.prepare(`SELECT conversation_id, title, workspace_uris, last_modified_time
        FROM conversation_summaries ORDER BY last_modified_time DESC LIMIT 500`).all();
      // Antigravity stores the archive flag in the search index, separate from summaries.
      let archived = new Set();
      try {
        archived = new Set(db.prepare('SELECT conversation_id FROM conversations_fts WHERE chunk_index = -1 AND archived = 1').all().map(row => row.conversation_id));
      } catch {}
      return rows.filter(row => validId.test(row.conversation_id) && !archived.has(row.conversation_id)).map(task);
    }, []);
  }

  detail(id) {
    if (!id.startsWith(prefix)) return null;
    const originalId = id.slice(prefix.length);
    if (!validId.test(originalId)) return null;
    return this.read(db => {
      const row = db.prepare(`SELECT conversation_id, title, workspace_uris, last_modified_time, substr(preview, 1, 4000) AS preview
        FROM conversation_summaries WHERE conversation_id = ?`).get(originalId);
      if (!row) return null;
      let excerpts = [];
      try {
        const archived = db.prepare('SELECT 1 FROM conversations_fts WHERE conversation_id = ? AND archived = 1 LIMIT 1').get(originalId);
        if (archived) return null;
        excerpts = db.prepare(`SELECT chunk_index, substr(user_body, 1, 4000) AS user_text, substr(agent_body, 1, 4000) AS agent_text
          FROM conversations_fts WHERE conversation_id = ? AND chunk_index >= 0
          ORDER BY chunk_index DESC LIMIT 12`).all(originalId).reverse();
      } catch {}
      const messages = [{id:'agy-preview-note',role:'agent',type:'text',text:'此处显示 Antigravity 本机索引中的对话摘录。完整会话在 Antigravity 中查看。'}];
      for (const chunk of excerpts) {
        if (chunk.user_text) messages.push({id:`agy-user-${chunk.chunk_index}`,role:'user',type:'text',text:chunk.user_text});
        if (chunk.agent_text) messages.push({id:`agy-agent-${chunk.chunk_index}`,role:'agent',type:'text',text:chunk.agent_text});
      }
      if (messages.length === 1 && row.preview) messages.push({id:'agy-preview',role:'agent',type:'text',text:row.preview});
      return { ...task(row), messages, hasMore:false };
    }, null);
  }
}

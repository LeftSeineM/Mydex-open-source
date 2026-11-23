import {createHash} from 'node:crypto';

export const remotePrefix = 'desktop:remote:';

function remoteId(hostId, threadId) {
  return remotePrefix + createHash('sha256').update(JSON.stringify([hostId, threadId])).digest('hex');
}

function metadata(thread, ref) {
  const status = thread.status?.type;
  return {id:ref.id || 'desktop:'+ref.threadId, hostId:ref.hostId,
    toolId:'codex', title:thread.title || ref.name || '远程会话', cwd:thread.cwd,
    status:status==='active'?'Running':status==='needsAttention'?'AwaitingApproval':'Completed',
    source:'desktop', readOnly:true, routerOriginal:true, canApprove:false, canInterrupt:false,
    remoteHostName:ref.hostName || '远端电脑', updatedAt:(thread.updatedAt || 0)*1000};
}

// Discover through the already-connected Codex desktop. Only host IDs actually
// returned by Codex are queried. Existing registered IDs remain stable.
export class RemoteDesktopCatalog {
  refs = new Map();
  rows = new Map();

  constructor(registered = []) {
    this.registered = registered;
    for (const ref of registered) this.refs.set('desktop:'+ref.threadId, ref);
  }

  registerRows(threads, expectedHost) {
    const hosts = new Set();
    for (const thread of threads) {
      const {hostId, id:threadId} = thread;
      if (thread.kind !== 'codex' || typeof threadId !== 'string' || !threadId ||
          typeof hostId !== 'string' || !hostId || hostId === 'local' ||
          (expectedHost && hostId !== expectedHost)) continue;
      const existing = this.registered.find(r => r.threadId === threadId && r.hostId === hostId);
      const ref = {...existing, hostId, threadId, id:existing ? 'desktop:'+threadId : remoteId(hostId, threadId)};
      this.refs.set(ref.id, ref);
      this.rows.set(ref.id, metadata(thread, ref));
      hosts.add(hostId);
    }
    return hosts;
  }

  async expand(desktop, hosts) {
    // Bound the amount of discovery work, and keep it off the local list path.
    for (const hostId of [...hosts].slice(0, 8)) {
      const seen = new Set();
      let cursor;
      for (let page = 0; page < 10; page++) {
        let result;
        try {
          result = await desktop.call('list_threads', {
            mode:'history', source:'codex', hostId, limit:50, ...(cursor ? {cursor} : {})
          });
        } catch { break; }
        this.registerRows(result.threads || [], hostId);
        cursor = result.nextCursor;
        if (!cursor || seen.has(cursor)) break;
        seen.add(cursor);
      }
    }
  }
}

// Verify the full original identity on every detail read.
export async function readRemoteDesktop(desktop, ref, {cursor, limit=3}={}) {
  const args={hostId:ref.hostId,threadId:ref.threadId,
    turnLimit:limit,includeOutputs:false,maxOutputCharsPerItem:4000,...cursor?{cursor}:{}};
  let r;
  try { r=await desktop.call('read_thread',args); }
  catch(error) {
    if(error.code!=='DESKTOP_RESPONSE_TOO_LARGE')throw error;
    r=await desktop.call('read_thread',{...args,turnLimit:1,maxOutputCharsPerItem:500});
  }
  if(r.thread?.id!==ref.threadId||r.thread?.hostId!==ref.hostId)throw Error('Remote conversation identity mismatch');
  const messages=[];
  for(const turn of [...(r.turns||[])].reverse())for(const item of turn.items||[]){
    if(['agentMessage','userMessage'].includes(item.type))messages.push({id:item.id,
      role:item.type==='userMessage'?'user':'agent',type:'text',
      text:item.text||(item.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n')});
  }
  return {...metadata(r.thread,ref),messages,approvals:[],
    nextCursor:r.page?.nextCursor,hasMore:!!r.page?.hasMore,turnId:r.turns?.[0]?.id,
    instance:ref.hostId+':'+ref.threadId};
}

import { promises as fs } from 'fs';
import path from 'path';
import { AgentSettings, JsonRpcId, ServerRequest } from './types';

export type Permissions = Pick<AgentSettings, 'sandbox' | 'approvalPolicy'>;
export const PERMISSION_MODES: Record<string, Permissions> = {
  readOnly: { sandbox: 'read-only', approvalPolicy: 'on-request' },
  approval: { sandbox: 'workspace-write', approvalPolicy: 'on-request' },
  full: { sandbox: 'danger-full-access', approvalPolicy: 'never' }
};
function valid(value: unknown): value is Permissions {
  const p = value as Permissions;
  return !!p && ['read-only','workspace-write','danger-full-access'].includes(p.sandbox) && ['untrusted','on-request','never'].includes(p.approvalPolicy);
}
/** Persistent per-thread policy; defaults never overwrite an existing conversation. */
export class PermissionStore {
  private readonly values = new Map<string, Permissions>();
  private saving: Promise<void> = Promise.resolve();
  constructor(private readonly file: string) {}
  async load(): Promise<void> {
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid permissions record');
      for (const [key, value] of Object.entries(data)) {
        if (key.startsWith('draft:')) continue;
        if (!valid(value)) throw new Error('Invalid permissions record');
        this.values.set(key, value);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('对话权限记录无法读取，已停止加载，避免意外放宽权限'); }
  }
  get(key: string, defaults: Permissions): Permissions {
    if (typeof key !== 'string' || !key || key.length > 200) throw new Error('无效对话标识');
    if (!this.values.has(key)) this.values.set(key, valid(defaults) ? { sandbox: defaults.sandbox, approvalPolicy: defaults.approvalPolicy } : { ...PERMISSION_MODES.approval });
    return { ...this.values.get(key)! };
  }
  async set(key: string, value: Permissions): Promise<Permissions> {
    if (!valid(value)) throw new Error('无效权限');
    if (typeof key !== 'string' || !key || key.length > 200) throw new Error('无效对话标识');
    const next = { sandbox: value.sandbox, approvalPolicy: value.approvalPolicy };
    if (key.startsWith('draft:')) { this.values.set(key, next); return { ...next }; }
    const save = this.saving.catch(() => {}).then(async () => {
      const updated = new Map(this.values); updated.set(key, next);
      const snapshot = JSON.stringify(Object.fromEntries([...updated].filter(([id]) => !id.startsWith('draft:'))), null, 2);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file + '.tmp', snapshot, 'utf8');
      await fs.rename(this.file + '.tmp', this.file);
      // Policy becomes effective only after the atomic write succeeds.
      this.values.set(key, next);
    });
    this.saving = save;
    await save;
    return { ...value };
  }
}

/** Only a live engine request can be answered. Renderer data cannot expand a grant. */
export class ApprovalRequests {
  private readonly pending = new Map<JsonRpcId, ServerRequest>();
  add(request: ServerRequest): void { this.pending.set(request.id, structuredClone(request)); }
  clear(threadId?: string): void {
    for (const [id, request] of this.pending) if (!threadId || request.params?.threadId === threadId) this.pending.delete(id);
  }
  resolve(id: JsonRpcId): void { this.pending.delete(id); }
  private request(id: JsonRpcId): ServerRequest {
    const request = this.pending.get(id);
    if (!request) throw new Error('审批已失效或已处理，请勿重复提交');
    return request;
  }
  decision(id: JsonRpcId, decision: string): unknown {
    const request = this.request(id);
    if (!['item/commandExecution/requestApproval','item/fileChange/requestApproval'].includes(request.method)) throw new Error('审批类型不匹配');
    if (!['accept','acceptForSession','decline','cancel'].includes(decision)) throw new Error('无效审批');
    const available = request.params?.availableDecisions;
    if (Array.isArray(available) && !available.includes(decision)) throw new Error('引擎不允许此审批选项');
    this.resolve(id); return { decision };
  }
  permissions(id: JsonRpcId, allow: boolean, scope: string): unknown {
    const request = this.request(id);
    if (request.method !== 'item/permissions/requestApproval' || typeof allow !== 'boolean' || !['turn','session'].includes(scope)) throw new Error('无效权限授权');
    const requested = request.params?.permissions as Record<string, unknown> || {};
    const permissions: Record<string, unknown> = {};
    if (allow) for (const key of ['network','fileSystem']) if (requested[key] != null) permissions[key] = requested[key];
    this.resolve(id); return { permissions, scope: allow ? scope : 'turn' };
  }
  answers(id: JsonRpcId, answers: Record<string, { answers: string[] }>): unknown {
    const request = this.request(id);
    if (request.method !== 'item/tool/requestUserInput') throw new Error('审批类型不匹配');
    const questions = request.params?.questions as Array<{id:string}> || [];
    if (!answers || Object.keys(answers).some(key => !questions.some(q => q.id === key)) || questions.some(q => !Array.isArray(answers[q.id]?.answers) || answers[q.id].answers.some(a => typeof a !== 'string' || a.length > 100000))) throw new Error('回答格式无效');
    this.resolve(id); return { answers };
  }
}

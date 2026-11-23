import { app, safeStorage } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { AgentSettings, ConnectionProfile } from './types';
const DEFAULTS: AgentSettings = {
  localExecutable: '', cwd: '', model: '', sandbox: 'workspace-write', approvalPolicy: 'on-request',
  theme: 'system', apiBaseUrl: 'https://api.openai.com/v1', apiKeyConfigured: false,
  activeProfileId: 'default', connectionProfiles: [], reasoningEffort: 'medium', contextWindow: 32768, projects: []
};
export function validateEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('请输入完整 API Base URL'); }
  if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('API 地址必须使用 HTTPS；本机允许 HTTP，地址中不能包含密钥');
  return url.href.replace(/\/+$/, '');
}
export type ProfileInput = Partial<ConnectionProfile> & { apiKey?: string; clearKey?: boolean };
export class SettingsStore {
  private values: AgentSettings = { ...DEFAULTS, projects: [], connectionProfiles: [] };
  private readonly filePath = path.join(app.getPath('userData'), 'settings.json');
  private keyFile(id: string): string {
    if (!/^[a-z0-9_-]{1,40}$/i.test(id)) throw new Error('API 配置 ID 无效');
    return path.join(app.getPath('userData'), id === 'default' ? 'api-key.enc' : 'connection-keys/' + id + '.enc');
  }
  async readApiKey(id = this.values.activeProfileId): Promise<string> {
    if (!this.values.connectionProfiles.some(p => p.id === id)) throw new Error('未找到 API 配置');
    try { return safeStorage.decryptString(await fs.readFile(this.keyFile(id))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw new Error('无法解密 API Key，请在设置中重新保存'); }
  }
  async saveApiKey(value: string, id = this.values.activeProfileId): Promise<void> {
    if (typeof value !== 'string' || value.length > 8192 || /[\r\n]/.test(value)) throw new Error('API Key 格式无效');
    const keyPath = this.keyFile(id);
    await fs.mkdir(path.dirname(keyPath), { recursive: true });
    if (!value) { await fs.rm(keyPath, { force: true }); return; }
    if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) throw new Error('系统安全存储不可用，拒绝明文保存 API Key');
    const temp = keyPath + '.tmp'; await fs.writeFile(temp, safeStorage.encryptString(value)); await fs.rename(temp, keyPath);
  }
  private async refreshKeyFlags(): Promise<void> {
    for (const p of this.values.connectionProfiles) p.apiKeyConfigured = Boolean(await fs.stat(this.keyFile(p.id)).catch(() => null));
    this.values.apiKeyConfigured = Boolean(this.values.connectionProfiles.find(p => p.id === this.values.activeProfileId)?.apiKeyConfigured);
  }
  private syncActive(): void {
    const p = this.values.connectionProfiles.find(p => p.id === this.values.activeProfileId)!;
    for (const key of ['apiBaseUrl', 'model', 'contextWindow', 'reasoningEffort'] as const) Object.assign(this.values, { [key]: p[key] });
  }
  private async persist(): Promise<AgentSettings> {
    await this.refreshKeyFlags(); await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = this.filePath + '.tmp'; await fs.writeFile(temp, JSON.stringify(this.values, null, 2), 'utf8'); await fs.rename(temp, this.filePath);
    return this.get();
  }
  async load(): Promise<AgentSettings> {
    try {
      const saved = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as Partial<AgentSettings>;
      this.values = { ...DEFAULTS, projects: [], connectionProfiles: [] };
      for (const key of Object.keys(DEFAULTS) as (keyof AgentSettings)[]) if (key in saved) Object.assign(this.values, { [key]: saved[key] });
      if (!Array.isArray(this.values.projects)) this.values.projects = [];
      if (this.values.localExecutable === 'mydex-local') this.values.localExecutable = '';
      const ids = new Set<string>();
      this.values.connectionProfiles = (Array.isArray(saved.connectionProfiles) ? saved.connectionProfiles : []).slice(0, 100).map(p => {
        if (!p || !/^[a-z0-9_-]{1,40}$/i.test(p.id) || ids.has(p.id)) throw new Error('API 配置格式无效');
        ids.add(p.id);
        return { id: p.id, name: String(p.name || 'API').slice(0, 48), apiBaseUrl: validateEndpoint(p.apiBaseUrl), model: String(p.model || '').slice(0, 256), contextWindow: p.contextWindow || 32768, reasoningEffort: p.reasoningEffort || 'none', apiKeyConfigured: false };
      });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('读取本机设置失败，请检查设置文件或从备份恢复'); }
    if (!this.values.connectionProfiles.length) {
      this.values.activeProfileId = 'default';
      this.values.connectionProfiles = [{ id: 'default', name: '原有 API', apiBaseUrl: this.values.apiBaseUrl, model: this.values.model, contextWindow: this.values.contextWindow, reasoningEffort: this.values.reasoningEffort, apiKeyConfigured: false }];
    }
    if (!this.values.connectionProfiles.some(p => p.id === this.values.activeProfileId)) this.values.activeProfileId = this.values.connectionProfiles[0].id;
    this.syncActive(); await this.refreshKeyFlags(); return this.get();
  }
  get(): AgentSettings { return structuredClone(this.values); }
  async update(patch: Partial<AgentSettings>): Promise<AgentSettings> {
    const { connectionProfiles: _profiles, activeProfileId: _id, ...allowed } = patch;
    this.values = { ...this.values, ...allowed };
    const p = this.values.connectionProfiles.find(p => p.id === this.values.activeProfileId)!;
    for (const key of ['apiBaseUrl', 'model', 'contextWindow', 'reasoningEffort'] as const) if (key in patch) Object.assign(p, { [key]: this.values[key] });
    if (patch.cwd) this.values.projects = [patch.cwd, ...this.values.projects.filter(p => p !== patch.cwd)].slice(0, 20);
    return this.persist();
  }
  async saveProfile(input: ProfileInput): Promise<AgentSettings> {
    const id = input.id || randomUUID(); this.keyFile(id);
    const previous = this.values.connectionProfiles.find(p => p.id === id);
    if (input.id && !previous) throw new Error('未找到 API 配置');
    if (!previous && this.values.connectionProfiles.length >= 100) throw new Error('最多保存 100 套 API 配置');
    const name = String(input.name || '').trim();
    if (!name || name.length > 48) throw new Error('配置名称应为 1–48 个字符');
    const contextWindow = input.contextWindow ?? 32768;
    if (!Number.isInteger(contextWindow) || contextWindow < 4096 || contextWindow > 2000000) throw new Error('上下文容量应在 4096–2000000 之间');
    const reasoningEffort = input.reasoningEffort || 'none';
    if (!['none', 'low', 'medium', 'high', 'xhigh'].includes(reasoningEffort)) throw new Error('无效思考强度');
    const model = String(input.model || '').trim();
    if (model.length > 256 || /[\x00-\x1f]/.test(model)) throw new Error('模型 ID 无效');
    const p: ConnectionProfile = { id, name, apiBaseUrl: validateEndpoint(String(input.apiBaseUrl || '')), model, contextWindow, reasoningEffort, apiKeyConfigured: false };
    if (input.apiKey) await this.saveApiKey(input.apiKey, id); else if (input.clearKey) await this.saveApiKey('', id);
    if (previous) this.values.connectionProfiles = this.values.connectionProfiles.map(item => item.id === id ? p : item);
    else this.values.connectionProfiles.push(p);
    this.values.activeProfileId = id; this.syncActive(); return this.persist();
  }
  async activateProfile(id: string): Promise<AgentSettings> {
    if (!this.values.connectionProfiles.some(p => p.id === id)) throw new Error('未找到 API 配置');
    this.values.activeProfileId = id; this.syncActive(); return this.persist();
  }
  async deleteProfile(id: string): Promise<AgentSettings> {
    if (!this.values.connectionProfiles.some(p => p.id === id)) throw new Error('未找到 API 配置');
    if (this.values.connectionProfiles.length <= 1) throw new Error('至少保留一套 API 配置');
    this.values.connectionProfiles = this.values.connectionProfiles.filter(p => p.id !== id);
    if (id === this.values.activeProfileId) { this.values.activeProfileId = this.values.connectionProfiles[0].id; this.syncActive(); }
    const result = await this.persist(); await fs.rm(this.keyFile(id), { force: true }); return result;
  }
}

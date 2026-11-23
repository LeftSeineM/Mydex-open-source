import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

// Only the isolated, trusted app renderer can invoke these actions.
export function registerWorkspaceTools(trust: (event: Electron.IpcMainInvokeEvent) => void, workspace: () => string, window: () => BrowserWindow, emit: (channel: string, payload: unknown) => void): void {
  let running: ReturnType<typeof spawn> | undefined;
  const stopCommand = () => {
    if (!running?.pid) return;
    const child = running;
    if (process.platform === 'win32') spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }).on('error', () => child.kill());
    else child.kill();
  };
  app.on('before-quit', stopCommand);
  ipcMain.handle('workspace:git', async event => {
    trust(event);
    const cwd = workspace();
    const run = (args: string[]) => new Promise<string>((resolve, reject) => {
      const child = spawn('git', args, { cwd, windowsHide: true, shell: false, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } });
      let output = ''; let error = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('Git 查询超时')); }, 15_000);
      child.stdout.on('data', data => { output = (output + data).slice(0, 2_000_000); });
      child.stderr.on('data', data => { error = (error + data).slice(0, 10_000); });
      child.on('error', e => { clearTimeout(timer); reject(e); });
      child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(error || '当前项目不是 Git 仓库')); });
    });
    const [status, diff] = await Promise.all([run(['status', '--short', '--branch']), run(['--no-pager', 'diff', '--no-ext-diff', '--no-textconv', 'HEAD'])]);
    return { status, diff };
  });
  ipcMain.handle('workspace:open', async event => { trust(event); const error = await shell.openPath(workspace()); if (error) throw new Error(error); });
  ipcMain.handle('workspace:export', async (event, input: { title: string; content: string }) => {
    trust(event);
    const result = await dialog.showSaveDialog(window(), { title: '导出任务', defaultPath: path.join(workspace(), `${String(input.title).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 70) || 'task'}.md`), filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (!result.canceled && result.filePath) await fs.writeFile(result.filePath, String(input.content).slice(0, 5_000_000), 'utf8');
    return !result.canceled;
  });
  ipcMain.handle('workspace:command', async (event, input: { command: string }) => {
    trust(event);
    if (running) throw new Error('已有命令正在运行');
    const cwd = workspace(); const command = String(input.command || '').trim();
    if (!command || command.length > 16_000) throw new Error('命令为空或过长');
    const approval = await dialog.showMessageBox(window(), { type: 'warning', title: '执行本机命令', message: '此命令以你的用户权限运行，不在代理沙箱内。', detail: `工作目录：${cwd}\n\n${command}`, buttons: ['取消', '执行'], defaultId: 0, cancelId: 0 });
    if (approval.response !== 1) return false;
    if (running) throw new Error('已有命令正在运行');
    const child = spawn(process.platform === 'win32' ? 'powershell.exe' : '/bin/sh', process.platform === 'win32' ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command], { cwd, windowsHide: true, shell: false });
    running = child;
    emit('terminal', { text: `> ${command}\n`, running: true });
    child.stdout.on('data', data => emit('terminal', { text: data.toString(), running: true }));
    child.stderr.on('data', data => emit('terminal', { text: data.toString(), running: true }));
    child.on('error', error => emit('terminal', { text: `${error.message}\n`, running: false }));
    child.on('close', code => { if (running === child) running = undefined; emit('terminal', { text: `\n[退出 ${code}]\n`, running: false }); });
    return true;
  });
  ipcMain.handle('workspace:stop-command', event => { trust(event); stopCommand(); });
}

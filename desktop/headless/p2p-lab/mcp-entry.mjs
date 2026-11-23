import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export async function openP2pLab() {
  const executable = fileURLToPath(new URL('../../../Mydex-P2P-Test.exe', import.meta.url));
  const child = spawn(executable, [], { detached: true, stdio: 'ignore', windowsHide: true });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  return { launched: true, scope: 'local P2P diagnostics' };
}

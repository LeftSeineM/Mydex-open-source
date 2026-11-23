// Discovery stays in the main process: no API key crosses the preload boundary.
export async function listApiModels(baseUrl: string, key: string): Promise<string[]> {
  const url = new URL(baseUrl.replace(/\/$/, '') + '/models');
  if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('模型列表地址必须为 HTTPS 或本机 HTTP');
  }
  if (!key) throw new Error('请先保存 API Key');
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  } catch { throw new Error('模型列表连接失败或超时；可在设置中手动填写模型 ID'); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`模型列表请求失败（HTTP ${response.status}）；可手动填写模型 ID`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('模型列表为空');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error('模型列表响应过大');
      chunks.push(value);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!Array.isArray(data.data)) throw new Error('Invalid models');
    return [...new Set<string>(data.data.map((item: { id?: unknown }) => item?.id)
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 256 && !/[\x00-\x1f]/.test(id)))].slice(0, 2000).sort();
  } catch { throw new Error('模型列表格式无效、过大或读取失败；可手动填写模型 ID'); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

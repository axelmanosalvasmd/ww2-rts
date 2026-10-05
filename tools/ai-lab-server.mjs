import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
export async function serveAiLab({ root = resolve(import.meta.dirname, '..'), host = '127.0.0.1', port = 3048 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Port must be 0..65535; zero requests an ephemeral port');
  const client = await realpath(resolve(root, 'client'));
  const shared = await realpath(resolve(root, 'shared')), tools = await realpath(import.meta.dirname);
  const names = new Set(['ai-lab.html', 'ai-lab-browser.mjs', 'ai-lab-runner.mjs']);
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let base, file;
      if (path === '/') { base = tools; file = resolve(base, 'ai-lab.html'); }
      else if (path.startsWith('/tools/') && names.has(path.slice(7))) { base = tools; file = resolve(base, path.slice(7)); }
      else if (path === '/client/keys.js') { base = client; file = resolve(base, 'keys.js'); }
      else if (path.startsWith('/shared/') && path.endsWith('.js')) { base = shared; file = resolve(base, path.slice(8)); }
      else { res.writeHead(404); res.end('Not found'); return; }
      file = await realpath(file); if (!file.startsWith(base + sep)) { res.writeHead(404); res.end('Not found'); return; }
      const data = await readFile(file); res.writeHead(200, { 'Content-Type': extname(file) === '.html' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' }); res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  console.log(`AI lab: http://${host}:${server.address().port}/tools/ai-lab.html\nSimulation root: ${root}`);
  return server;
}

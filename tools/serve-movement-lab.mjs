import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let root = checkout, port = 3047;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i], value = process.argv[++i];
  if (arg === '--root' && value) root = resolve(value);
  else if (arg === '--port' && value && /^\d+$/.test(value)) port = Number(value);
  else throw new Error('Usage: node tools/serve-movement-lab.mjs [--port 3047] [--root DIR]');
}
if (port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535');
root = await realpath(root);
const labNames = new Set(['movement-lab.html', 'movement-lab-browser.js', 'movement-lab-scenarios.js', 'movement-lab-runner.js', 'terrain-workshop.html', 'terrain-workshop.js', 'terrain-workshop-fixtures.js']);
const clientBase = await realpath(resolve(checkout, 'client'));
const vendorBase = await realpath(resolve(checkout, 'node_modules/three/build'));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    let base, target;
    if (pathname === '/' || pathname === '/tools/movement-lab.html') {
      base = resolve(checkout, 'tools'); target = resolve(base, 'movement-lab.html');
    } else if (pathname.startsWith('/tools/') && labNames.has(pathname.slice(7))) {
      base = resolve(checkout, 'tools'); target = resolve(base, pathname.slice(7));
    } else if (pathname.startsWith('/shared/') && pathname.endsWith('.js')) {
      base = resolve(root, 'shared'); target = resolve(root, `.${pathname}`);
    } else if (pathname.startsWith('/client/') && ['.js', '.jpg', '.jpeg', '.png'].includes(extname(pathname))) {
      base = clientBase; target = resolve(base, pathname.slice(8));
    } else if (pathname.startsWith('/vendor/') && pathname.endsWith('.js')) {
      base = vendorBase; target = resolve(base, pathname.slice(8));
    } else { res.writeHead(404); res.end('Not found'); return; }
    target = await realpath(target);
    if (!target.startsWith(base + sep)) { res.writeHead(404); res.end('Not found'); return; }
    const data = await readFile(target);
    res.writeHead(200, { 'Content-Type': mime[extname(target)] ?? 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 400); res.end('Not found');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Movement lab: http://127.0.0.1:${port}/tools/movement-lab.html\nSimulation root: ${root}`));

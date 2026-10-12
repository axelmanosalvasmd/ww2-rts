// IP entry point preserves the secure origin required for browser WebTransport.
import http from 'node:http';
import { execFileSync } from 'node:child_process';
const host = execFileSync('tailscale', ['ip', '-4'], { encoding: 'utf8' }).trim();
const status = JSON.parse(execFileSync('tailscale', ['status', '--json'], { encoding: 'utf8' }));
const dns = status.Self.DNSName.replace(/\.$/, '');
if (!/^100\.\d+\.\d+\.\d+$/.test(host) || !/^[a-z0-9.-]+\.ts\.net$/i.test(dns)) throw Error('Invalid tailnet address');
http.createServer((req, res) => {
  const path = req.url === '/' ? '/play?transport=webtransport' : req.url;
  if (!path.startsWith('/') || path.startsWith('//') || /[\r\n]/.test(path)) { res.writeHead(400); res.end(); return; }
  res.writeHead(302, { Location: `https://${dns}:8443${path}`, 'Cache-Control': 'no-store' });
  res.end();
}).listen(3202, host, () => console.log(`Tailscale entry: http://${host}:3202/play?transport=webtransport`));

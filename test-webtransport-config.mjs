import assert from 'node:assert/strict';
import { check } from './test-check.js';
import { webTransportConfig } from './server/webtransport-config.js';
const local = { host: '127.0.0.1', shards: 1, publicUrl: 'http://127.0.0.1:3100' };
await check('WebTransport disabled ignores invalid remote configuration', () => {
  assert.equal(webTransportConfig({ WW2_WT_TAILNET: '1' }, { publicUrl: 'invalid' }), null);
});
await check('WebTransport local restricts both origins and listeners', () => {
  assert.deepEqual(webTransportConfig({ WW2_WEBTRANSPORT: '1' }, local), { port: 3101, host: '127.0.0.1', allowedOrigin: local.publicUrl });
  for (const options of [{ ...local, host: '0.0.0.0' }, { ...local, shards: 2 }, { ...local, publicUrl: 'http://evil.invalid' }]) assert.throws(() => webTransportConfig({ WW2_WEBTRANSPORT: '1' }, options));
  for (const port of ['0', '-1', '70000', '1.5', 'NaN']) assert.throws(() => webTransportConfig({ WW2_WEBTRANSPORT: '1', WW2_QUIC_PORT: port }, local));
  assert.throws(() => webTransportConfig({ WW2_WEBTRANSPORT: '1', WW2_QUIC_HOST: '100.64.0.1' }, local));
});
await check('WebTransport tailnet requires current address and exact HTTPS hostname', () => {
  const status = { BackendState: 'Running', TailscaleIPs: ['100.64.0.1'], Self: { DNSName: 'game.example.ts.net.' } };
  const env = { WW2_WEBTRANSPORT: '1', WW2_WT_TAILNET: '1', WW2_QUIC_HOST: '100.64.0.1', WW2_QUIC_PORT: '3201' };
  const options = { ...local, publicUrl: 'https://game.example.ts.net:8443', status };
  assert.equal(webTransportConfig(env, options).allowedOrigin, options.publicUrl);
  assert.throws(() => webTransportConfig({ ...env, WW2_QUIC_HOST: '100.64.0.2' }, options));
  assert.throws(() => webTransportConfig(env, { ...options, publicUrl: 'https://evil.invalid:8443' }));
  assert.throws(() => webTransportConfig(env, { ...options, status: { ...status, BackendState: 'Stopped' } }));
});

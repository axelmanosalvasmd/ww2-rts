// WebTransport is opt-in. Default startup never reads remote-mode configuration.
export function webTransportConfig(env, { host, shards, publicUrl, status } = {}) {
  if (env.WW2_WEBTRANSPORT !== '1') return null;
  if (host !== '127.0.0.1' || shards !== 1) throw Error('WebTransport requires loopback HTTP and one shard');
  const quicHost = env.WW2_QUIC_HOST || '127.0.0.1';
  const origin = new URL(publicUrl).origin;
  const port = Number(env.WW2_QUIC_PORT || 3101);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid QUIC port');
  if (env.WW2_WT_TAILNET === '1') {
    if (status?.BackendState !== 'Running' || quicHost !== status.TailscaleIPs?.find(ip => /^100\./.test(ip))) throw Error('QUIC must bind current Tailscale IPv4 only');
    if (origin !== `https://${status.Self.DNSName.replace(/\.$/, '')}:8443`) throw Error('Tailnet HTTPS origin must match current Tailscale hostname on 8443');
  } else {
    if (quicHost !== '127.0.0.1') throw Error('Remote QUIC requires explicit WW2_WT_TAILNET=1');
    const url = new URL(publicUrl);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw Error('Local WebTransport requires loopback HTTP origin');
  }
  return { port, host: quicHost, allowedOrigin: origin };
}

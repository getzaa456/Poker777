// Simulates an unstable network for one player.
// TCP proxy :4200 -> backend :4000, controlled over HTTP on :4299:
//   GET /up      normal
//   GET /drop    cut every connection and refuse new ones (signal lost)
//   GET /freeze  keep connections open but pass no data (half-dead link)
//   GET /status  current mode
import net from 'node:net';
import http from 'node:http';

let mode = 'up';
const conns = new Set();

net.createServer((client) => {
  if (mode === 'drop') { client.destroy(); return; }
  const upstream = net.connect(4000, '127.0.0.1');
  const c = { client, upstream };
  conns.add(c);
  const fwd = (from, to) => from.on('data', (d) => { if (mode === 'up') to.write(d); });
  fwd(client, upstream);
  fwd(upstream, client);
  const end = () => { conns.delete(c); client.destroy(); upstream.destroy(); };
  client.on('close', end); upstream.on('close', end);
  client.on('error', end); upstream.on('error', end);
}).listen(4200);

http.createServer((req, res) => {
  const m = req.url.slice(1);
  if (['up', 'drop', 'freeze'].includes(m)) {
    mode = m;
    if (m === 'drop') for (const c of conns) { c.client.destroy(); c.upstream.destroy(); }
  }
  res.end(`mode=${mode} connections=${conns.size}\n`);
}).listen(4299);

console.log('[flaky] proxy on :4200 -> :4000, control on http://localhost:4299/{up,drop,freeze,status}');

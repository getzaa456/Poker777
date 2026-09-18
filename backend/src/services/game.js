import { URL } from 'node:url';
import { jwt } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { wss } from '../ws/Old-server.js';


export function handleTableUpgrade(request, socket, head) {
  try {
    const url = new URL(request.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const claims = jwt.verify(token, env.jwt.secret, { issuer: env.jwt.issuer });
    request.userId = String(claims.sub);
  } catch (_) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    ws.userId = request.userId;
    wss.emit('connection', ws, request);
  });
}
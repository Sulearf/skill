/**
 * 本地静态服务 + 数据接口（零第三方依赖）。
 *
 *   GET /                  → 302 → /web/（入口页地址必须带 /web/ 前缀，相对路径才能正确解析）
 *   GET /web/              → web/index.html
 *   GET /api/snapshot      → data/snapshot.json（运行时唯一数据来源）
 *   GET /api/health        → 健康检查
 *   GET /<其它路径>         → 项目根目录下的静态文件（web/、assets/、data/）
 *
 * 运行时不调用麦当劳接口，因此不会登录、支付或下单。
 *
 * 用法：node scripts/server.js   （PORT 环境变量可改端口，默认 5173）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = '/web/index.html';
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let p = decodeURIComponent(url.pathname);

  if (p === '/api/snapshot') {
    try {
      const json = fs.readFileSync(path.join(ROOT, 'data', 'snapshot.json'), 'utf8');
      return send(res, 200, json, { 'Content-Type': MIME['.json'] });
    } catch (e) {
      return send(res, 503, JSON.stringify({ error: 'snapshot unavailable', detail: e.message }), { 'Content-Type': MIME['.json'] });
    }
  }
  if (p === '/api/health') {
    return send(res, 200, JSON.stringify({ ok: true, ts: new Date().toISOString() }), { 'Content-Type': MIME['.json'] });
  }

  // 必须重定向而不是直接返回 index.html：
  // 否则浏览器地址仍是 /，页面里的相对路径（app.js）会被解析成 /app.js 而 404。
  if (p === '/' || p === '/web' || p === '') {
    return send(res, 302, '', { Location: '/web/' });
  }
  if (p === '/web/') p = HOME;

  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) return send(res, 403, 'forbidden');

  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'not found');
    send(res, 200, buf, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`麦当劳拼单工具已启动： http://localhost:${PORT}`);
  console.log(`静态根目录： ${ROOT}`);
});

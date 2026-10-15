'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fixture } = require('./2026-10-16-dashboard-fixtures.cjs');
const root = path.resolve(__dirname, '..');
const calls = [];
let server;
(async () => {
  const { createServer } = await import(pathToFileURL(path.join(root, 'client/node_modules/vite/dist/node/index.js')).href);
  server = await createServer({
    root: path.join(root, 'client'), configFile: path.join(root, 'client/vite.config.js'),
    cacheDir: path.join(__dirname, '2026-10-16-vite-cache'),
    server: { host: 'localhost', port: 5220, strictPort: true, fs: { allow: [root] } },
    plugins: [{
      name: 'read-only-dashboard-fixtures', enforce: 'pre',
      resolveId(id) { if (id === '../api/client') return '\0dashboard-qa-api'; },
      load(id) {
        if (id === '\0dashboard-qa-api') return `export async function api(route,options={}) {
          if(options.method && options.method!=='GET') throw Error('QA writes are disabled');
          const response=await fetch('/__qa/data'+new URL(route,location.origin).search);
          if(!response.ok) throw Error('QA read failed');
          return response.json();
        }`;
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url, 'http://localhost:5220');
          const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
          if (url.pathname.startsWith('/api/')) { send(403, { message: 'Live APIs are blocked in QA' }); return; }
          if (!url.pathname.startsWith('/__qa')) return next();
          if (url.pathname === '/__qa') {
            const html = await vite.transformIndexHtml(req.url, `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>정처기메이트 대시보드 QA</title></head><body><div id="root"></div><script type="module" src="/@fs/${path.join(__dirname, '2026-10-16-browser-entry.jsx')}"></script></body></html>`);
            res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); return;
          }
          if (url.pathname === '/__qa/data' && req.method === 'GET') {
            calls.push({ method: 'GET', period: url.searchParams.get('period') });
            send(200, fixture(url.searchParams.get('period'))); return;
          }
          if (url.pathname === '/__qa/stop' && req.method === 'POST') {
            fs.writeFileSync(path.join(__dirname, '2026-10-16-fixture-calls.json'), JSON.stringify({ backendConnections: 0, writes: 0, calls }, null, 2), { flag: 'wx' });
            send(200, { backendConnections: 0, writes: 0, calls: calls.length });
            setTimeout(async () => { await server.close(); process.exit(0); }, 50); return;
          }
          send(403, { message: 'Read-only fixture endpoint' });
        });
      },
    }],
  });
  await server.listen();
  console.log('Read-only dashboard QA: http://localhost:5220/__qa');
})().catch((error) => { console.error(error); process.exitCode = 1; });

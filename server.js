import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Normalize the root so the containment check below does not append a second
// path separator when fileURLToPath returns a trailing separator.
const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.gif': 'image/gif', '.png': 'image/png', '.mp4': 'video/mp4' };

async function readPublicCloudConfig() {
  const values = { SUPABASE_URL: process.env.SUPABASE_URL || '', SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '' };
  try {
    const envText = await readFile(resolve(root, '.env.local'), 'utf8');
    for (const line of envText.split(/\r?\n/)) {
      const match = /^\s*(SUPABASE_URL|SUPABASE_ANON_KEY)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && !values[match[1]]) values[match[1]] = match[2].replace(/^(?:"([^"]*)"|'([^']*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted);
    }
  } catch { /* Cloud auth remains disabled until optional local config is supplied. */ }
  return values;
}

function isServiceRoleKey(value) {
  if (/^sb_secret_/i.test(value)) return true;
  const payload = value.split('.')[1];
  if (!payload) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role === 'service_role'; }
  catch { return false; }
}

const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end('Bad request'); return; }
  if (pathname.split('/').some((part) => part === '.env' || part.startsWith('.env.'))) { response.writeHead(404).end('Not found'); return; }
  if (pathname === '/runtime-config.json') {
    const config = await readPublicCloudConfig();
    const privateKeyDetected = isServiceRoleKey(config.SUPABASE_ANON_KEY);
    const configured = Boolean(config.SUPABASE_URL && config.SUPABASE_ANON_KEY && !privateKeyDetected);
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(configured ? { configured: true, supabaseUrl: config.SUPABASE_URL, anonKey: config.SUPABASE_ANON_KEY } : { configured: false, ...(privateKeyDetected ? { reason: 'private-key-rejected' } : {}) }));
    return;
  }
  // Keep the original tracker as a standalone document while the public root
  // serves the new landing page. Both public app entry routes retain their URL.
  if (pathname === '/') pathname = '/index.html';
  else if (pathname === '/app' || pathname === '/app/' || pathname === '/dashboard' || pathname === '/dashboard/' || pathname === '/signin' || pathname === '/signin/') pathname = '/tracker.html';
  const target = resolve(root, `.${pathname}`);
  if (target !== root && !target.startsWith(root + sep)) { response.writeHead(403).end('Forbidden'); return; }
  try {
    const body = await readFile(target);
    response.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    if (request.method === 'HEAD') response.end(); else response.end(body);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error.code === 'ENOENT' ? 'Not found' : 'Unable to read requested file');
  }
});

const hasExplicitPort = Boolean(process.env.PORT);
const startingPort = Number(hasExplicitPort ? process.env.PORT : 4173);

if (!Number.isInteger(startingPort) || startingPort < 1 || startingPort > 65535) {
  console.error(`Invalid PORT value: ${process.env.PORT}`);
  process.exitCode = 1;
} else {
  function listenAt(port) {
    const onError = (error) => {
      // Remove this attempt's listener before retrying; otherwise prior
      // EADDRINUSE handlers also react to the next port and report false URLs.
      server.removeListener('error', onError);
      if (error.code === 'EADDRINUSE' && !hasExplicitPort && port < 65535) {
        const nextPort = port + 1;
        console.warn(`Port ${port} is already in use; trying ${nextPort}.`);
        listenAt(nextPort);
        return;
      }

      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Stop the other server or choose another port with PORT=<port>.`);
      } else {
        console.error(`Could not start Habit Tracker: ${error.message}`);
      }
      process.exitCode = 1;
    };

    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      console.log(`Habit Tracker running at http://127.0.0.1:${port}`);
    });
  }

  listenAt(startingPort);
}

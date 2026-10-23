function isServiceRoleKey(value) {
  if (/^sb_secret_/i.test(value)) return true;
  const payload = value.split('.')[1];
  if (!payload) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role === 'service_role';
  } catch {
    return false;
  }
}

export default function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).end();
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '');
  const privateKeyDetected = isServiceRoleKey(anonKey);
  const configured = Boolean(supabaseUrl && anonKey && !privateKeyDetected);

  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  return response.status(200).json(configured
    ? { configured: true, supabaseUrl, anonKey }
    : { configured: false, ...(privateKeyDetected ? { reason: 'private-key-rejected' } : {}) });
}

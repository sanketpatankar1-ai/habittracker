const SESSION_KEY = 'ht_cloud_session';

function readSession(storage) {
  try { const value = JSON.parse(storage.getItem(SESSION_KEY) || 'null'); return value && typeof value.access_token === 'string' ? value : null; }
  catch { return null; }
}

function authError(payload, status) {
  const message = payload?.msg || payload?.error_description || payload?.message || payload?.error || `Cloud request failed (${status}).`;
  const error = new Error(String(message));error.status=status;error.code=payload?.code;return error;
}

export async function loadCloudConfig(fetchImpl = fetch) {
  const response = await fetchImpl('/runtime-config.json', { cache: 'no-store' });
  if (!response.ok) return { configured: false };
  const config = await response.json();
  if (!config?.configured) {
    if (config?.reason === 'private-key-rejected') throw new Error('A Supabase service-role key was blocked from browser access. Set SUPABASE_ANON_KEY to the project publishable/anon key instead.');
    return { configured: false };
  }
  const url = String(config.supabaseUrl || '').replace(/\/$/, ''), anonKey = String(config.anonKey || '');
  if (!/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url)) throw new Error('SUPABASE_URL must use HTTPS (HTTP is allowed only for local development).');
  if (!anonKey || anonKey.length < 20) throw new Error('SUPABASE_ANON_KEY is missing or invalid.');
  if (/^sb_secret_/i.test(anonKey)) throw new Error('A Supabase service-role key cannot be used in the browser. Use the publishable/anon key.');
  return { configured: true, supabaseUrl: url, anonKey };
}

export function createSupabaseClient({ supabaseUrl, anonKey, storage = localStorage, fetchImpl = fetch, now = () => Date.now() }) {
  let session = readSession(storage);
  let refreshPromise = null;
  const saveSession = (next) => {
    session = next;
    if (next) storage.setItem(SESSION_KEY, JSON.stringify(next));
    else storage.removeItem(SESSION_KEY);
    return session;
  };

  async function request(path, { method = 'GET', body, token, headers = {} } = {}) {
    const response = await fetchImpl(`${supabaseUrl}${path}`, {
      method,
      headers: { apikey: anonKey, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = await response.text();
    let result = null;
    if (raw) { try { result = JSON.parse(raw); } catch { result = { message: raw }; } }
    if (!response.ok) throw authError(result, response.status);
    return result;
  }

  function setSession(result, type = 'authenticated') {
    if (!result?.access_token || !result?.refresh_token) return null;
    const next = { ...result, type, expires_at: Number(result.expires_at) || Math.floor(now() / 1000) + (Number(result.expires_in) || 3600) };
    return saveSession(next);
  }

  async function refreshSession() {
    if (!session?.refresh_token) return null;
    if (!refreshPromise) refreshPromise = request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } })
      .then((result) => setSession(result, session?.type || 'authenticated'))
      .catch((error) => { saveSession(null); throw error; })
      .finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  async function getSession() {
    if (!session) return null;
    if (!session.expires_at || session.expires_at * 1000 < now() + 60_000) return refreshSession();
    return session;
  }

  async function authenticatedRequest(path, options = {}) {
    let current = await getSession();
    if (!current) throw new Error('Your session expired. Sign in again to sync your tracker.');
    try { return await request(path, { ...options, token: current.access_token }); }
    catch (error) {
      if (!/401|JWT|token/i.test(error.message)) throw error;
      current = await refreshSession();
      if (!current) throw error;
      return request(path, { ...options, token: current.access_token });
    }
  }

  return {
    get session() { return session; },
    getSession,
    async getUser() {
      const current = await getSession();
      if (!current) return null;
      const user = await authenticatedRequest('/auth/v1/user');
      saveSession({ ...session, user });
      return user;
    },
    async signUp(email, password) {
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email address.');
      if (password.length < 8) throw new Error('Use a password with at least 8 characters.');
      const result = await request('/auth/v1/signup', { method: 'POST', body: { email, password } });
      const next = setSession(result, 'authenticated');
      return { ...result, session: next };
    },
    async signIn(email, password) {
      if (!/^\S+@\S+\.\S+$/.test(email) || !password) throw new Error('Enter your email and password.');
      const result = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
      return setSession(result, 'authenticated');
    },
    async requestPasswordReset(email) {
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email address first.');
      return request('/auth/v1/recover', { method: 'POST', body: { email } });
    },
    async updatePassword(password) {
      if (password.length < 8) throw new Error('Use a password with at least 8 characters.');
      const current = await getSession();
      if (!current) throw new Error('The reset link has expired. Request another password reset email.');
      const result = await authenticatedRequest('/auth/v1/user', { method: 'PUT', body: { password } });
      saveSession({ ...current, type: 'authenticated', user: result });
      return result;
    },
    async signOut() {
      const current = await getSession().catch(() => null);
      try { if (current) await request('/auth/v1/logout', { method: 'POST', token: current.access_token }); }
      finally { saveSession(null); }
    },
    async getTracker(userId) {
      if (!session?.user?.id || userId !== session.user.id) throw new Error('The requested tracker does not match the signed-in account.');
      const rows = await authenticatedRequest(`/rest/v1/user_tracker_documents?user_id=eq.${encodeURIComponent(session.user.id)}&select=user_id,data,revision,updated_at`);
      if (!Array.isArray(rows)) throw new Error('The cloud returned an invalid tracker response.');
      return rows.length ? rows[0] : null;
    },
    async saveTracker(userId, data, expectedRevision = 0) {
      if (!session?.user?.id || userId !== session.user.id) throw new Error('The tracker can only be saved to the signed-in account.');
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('The cloud revision is invalid.');
      return authenticatedRequest('/rest/v1/rpc/save_my_tracker_document', { method: 'POST', body: { p_data: data, p_expected_revision: expectedRevision } });
    },
    consumeRecoveryRedirect(locationObject = globalThis.location, historyObject = globalThis.history) {
      const fragment = new URLSearchParams(String(locationObject?.hash || '').replace(/^#/, ''));
      const accessToken = fragment.get('access_token'), refreshToken = fragment.get('refresh_token');
      const type = fragment.get('type');
      if (!accessToken || !refreshToken || !['recovery', 'signup', 'magiclink', 'invite', 'email_change'].includes(type)) return false;
      setSession({ access_token: accessToken, refresh_token: refreshToken, expires_in: fragment.get('expires_in'), user: session?.user }, type === 'recovery' ? 'recovery' : 'authenticated');
      historyObject?.replaceState?.(null, '', `${locationObject.pathname || '/'}${locationObject.search || ''}`);
      return true;
    },
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseClient, loadCloudConfig } from '../src/features/cloud/supabaseClient.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function response(data, status = 200) { return { ok: status >= 200 && status < 300, status, text: async () => data === null ? '' : JSON.stringify(data) }; }

test('runtime config accepts only a Supabase URL plus publishable key and treats missing config as local-only', async () => {
  const configResponse = (value) => ({ ok: true, json: async () => value });
  assert.deepEqual(await loadCloudConfig(async () => configResponse({ configured: false })), { configured: false });
  await assert.rejects(loadCloudConfig(async () => configResponse({ configured: false, reason: 'private-key-rejected' })), /service-role key was blocked/);
  assert.deepEqual(await loadCloudConfig(async () => configResponse({ configured: true, supabaseUrl: 'https://example.supabase.co/', anonKey: 'a'.repeat(30) })), { configured: true, supabaseUrl: 'https://example.supabase.co', anonKey: 'a'.repeat(30) });
  await assert.rejects(loadCloudConfig(async () => configResponse({ configured: true, supabaseUrl: 'http://example.com', anonKey: 'a'.repeat(30) })), /HTTPS/);
});

test('registration and login validate inputs and persist provider sessions, never credentials', async () => {
  const storage = new MemoryStorage(), calls = [];
  const client = createSupabaseClient({ supabaseUrl: 'https://unit.supabase.co', anonKey: 'public-anon-key-1234567890', storage, now: () => 1_800_000_000_000, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return response({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user: { id: 'user-1', email: 'a@example.test' } });
  } });
  await assert.rejects(client.signUp('invalid', 'password123', 'http://localhost'), /valid email/);
  await assert.rejects(client.signUp('a@example.test', 'short', 'http://localhost'), /8 characters/);
  const created = await client.signUp('a@example.test', 'password123', 'http://localhost');
  assert.equal(created.user.id, 'user-1');
  assert.equal(JSON.parse(storage.getItem('ht_cloud_session')).refresh_token, 'refresh');
  await client.signIn('a@example.test', 'password123');
  assert.match(calls[1].url, /\/auth\/v1\/token\?grant_type=password/);
  assert.ok(!storage.getItem('ht_cloud_session').includes('password123'));
});

test('email verification registration does not invent a session when the provider requires confirmation', async () => {
  const storage = new MemoryStorage();
  const client = createSupabaseClient({ supabaseUrl: 'https://unit.supabase.co', anonKey: 'public-anon-key-1234567890', storage, fetchImpl: async () => response({ user: { id: 'pending', email: 'a@example.test' }, session: null }) });
  const created = await client.signUp('a@example.test', 'password123', 'http://localhost:4173/');
  assert.equal(created.session, null);
  assert.equal(storage.getItem('ht_cloud_session'), null);
});

test('user-scoped REST reads and writes use the authenticated token and reject another client ID', async () => {
  const storage = new MemoryStorage(), calls = [];
  storage.setItem('ht_cloud_session', JSON.stringify({ access_token: 'my-user-access', refresh_token: 'r', expires_at: 2_000_000_000, user: { id: 'mine' } }));
  const client = createSupabaseClient({ supabaseUrl: 'https://unit.supabase.co', anonKey: 'public-anon-key-1234567890', storage, now: () => 1_800_000_000_000, fetchImpl: async (url, options) => { calls.push({ url, options });return response([{ user_id: 'mine', data: { habits: [] } }]); } });
  await client.getTracker('mine');
  await client.saveTracker('mine', { habits: [] }, 7);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer my-user-access');
  assert.match(calls[0].url, /user_id=eq\.mine/);
  assert.match(calls[1].url, /rpc\/save_my_tracker_document/);
  assert.deepEqual(JSON.parse(calls[1].options.body), { p_data: { habits: [] }, p_expected_revision: 7 });
  await assert.rejects(client.getTracker('other'), /does not match/);
  await assert.rejects(client.saveTracker('other', {}), /only be saved to the signed-in account/);
});

test('stale tracker revision is exposed for explicit conflict recovery instead of silently overwriting', async () => {
  const storage = new MemoryStorage();
  storage.setItem('ht_cloud_session', JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: 2_000_000_000, user: { id: 'mine' } }));
  const client = createSupabaseClient({ supabaseUrl: 'https://unit.supabase.co', anonKey: 'public-anon-key-1234567890', storage, fetchImpl: async () => response({ code: '40001', message: 'Tracker revision conflict. Refresh and merge local changes.' }, 400) });
  await assert.rejects(client.saveTracker('mine', {}, 2), (error) => error.code === '40001' && /revision conflict/.test(error.message));
});

test('expired sessions refresh and logout always clears persisted credentials', async () => {
  const storage = new MemoryStorage(), calls = [];
  storage.setItem('ht_cloud_session', JSON.stringify({ access_token: 'expired', refresh_token: 'r', expires_at: 1, user: { id: 'u' } }));
  const client = createSupabaseClient({ supabaseUrl: 'https://unit.supabase.co', anonKey: 'public-anon-key-1234567890', storage, now: () => 1_800_000_000_000, fetchImpl: async (url, options) => { calls.push(url);return url.includes('refresh_token') ? response({ access_token: 'new', refresh_token: 'new-r', expires_in: 3600, user: { id: 'u' } }) : response(null); } });
  assert.equal((await client.getSession()).access_token, 'new');
  await client.signOut();
  assert.equal(storage.getItem('ht_cloud_session'), null);
  assert.equal(calls.length, 2);
});

test('network and provider authentication errors remain actionable messages', async () => {
  const client = createSupabaseClient({ supabaseUrl: 'https://unit.supabase.co', anonKey: 'public-anon-key-1234567890', storage: new MemoryStorage(), fetchImpl: async () => response({ msg: 'Invalid login credentials' }, 400) });
  await assert.rejects(client.signIn('a@example.test', 'password123'), /Invalid login credentials/);
});

test('password reset uses provider defaults and recovery links are cleaned from the address bar', async () => {
  const storage = new MemoryStorage(), calls = [];
  const client = createSupabaseClient({ supabaseUrl: 'https://unit.supabase.co', anonKey: 'public-anon-key-1234567890', storage, fetchImpl: async (url, options) => { calls.push({ url, options });return url.endsWith('/user') ? response({ id: 'u', email: 'a@example.test' }) : response(null); } });
  await client.requestPasswordReset('a@example.test');
  assert.match(calls[0].url, /\/auth\/v1\/recover/);
  assert.deepEqual(JSON.parse(calls[0].options.body), { email: 'a@example.test' });
  const location = { hash: '#access_token=recovery-access&refresh_token=recovery-refresh&expires_in=3600&type=recovery', pathname: '/', search: '?x=1' };
  let cleaned = '';
  assert.equal(client.consumeRecoveryRedirect(location, { replaceState: (_state, _title, url) => { cleaned = url; } }), true);
  assert.equal(cleaned, '/?x=1');
  assert.equal((await client.getSession()).type, 'recovery');
  await client.updatePassword('new-password');
  assert.match(calls[1].url, /\/auth\/v1\/user/);
  assert.equal(JSON.parse(calls[1].options.body).password, 'new-password');
  assert.equal(client.session.type, 'authenticated');
});

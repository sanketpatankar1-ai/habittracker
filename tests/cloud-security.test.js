import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('cloud table migration enables forced RLS and scopes every operation to auth.uid()', async () => {
  const sql = await readFile(new URL('../db/migrations/0001_user_tracker_documents.sql', import.meta.url), 'utf8');
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /force row level security/i);
  assert.match(sql, /revoke all on table public\.user_tracker_documents from anon/i);
  assert.match(sql, /references auth\.users\s*\(id\) on delete cascade/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /save_my_tracker_document\(p_data jsonb, p_expected_revision bigint\)/i);
  assert.match(sql, /v_user_id := auth\.uid\(\)/i);
  assert.match(sql, /revision conflict/i);
  for (const operation of ['select', 'insert', 'update', 'delete']) assert.match(sql, new RegExp(`for ${operation} to authenticated`, 'i'));
  assert.equal((sql.match(/auth\.uid\(\)/g) || []).length, 6, 'policies and compare-and-save RPC all derive access from the authenticated user');
});

test('safe environment example includes only public Supabase settings, never a service-role key', async () => {
  const example = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(example, /SUPABASE_URL=/);
  assert.match(example, /SUPABASE_ANON_KEY=/);
  assert.doesNotMatch(example, /SERVICE_ROLE|DATABASE_PASSWORD|SECRET_KEY/i);
});

test('development server only exposes its two public config keys and blocks direct environment-file requests', async () => {
  const server = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /process\.env\.SUPABASE_URL/);
  assert.match(server, /process\.env\.SUPABASE_ANON_KEY/);
  assert.doesNotMatch(server, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(server, /part === '\.env' \|\| part\.startsWith\('\.env\.'\)/);
});

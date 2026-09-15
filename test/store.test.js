'use strict';

const test = require('node:test');
const assert = require('node:assert');
const store = require('../server/store');
const { PARSER_VERSION } = require('../server/parser');

function withStubs({ configured = true, fetch: handler }, run) {
  const realFetch = global.fetch;
  const realError = console.error;
  const realUrl = process.env.SUPABASE_URL;
  const realKey = process.env.SUPABASE_SERVICE_KEY;
  global.fetch = handler;
  console.error = () => {};
  if (configured) {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'sb_secret_test';
  } else {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
  }
  return Promise.resolve()
    .then(run)
    .finally(() => {
      global.fetch = realFetch;
      console.error = realError;
      if (realUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = realUrl;
      if (realKey === undefined) delete process.env.SUPABASE_SERVICE_KEY;
      else process.env.SUPABASE_SERVICE_KEY = realKey;
    });
}

const json = (rows) => ({ ok: true, status: 200, json: async () => rows });

test('a stored exam from the current parser is a hit; one from an older parser is a miss', async () => {
  const exam = { season: 'summer', year: 2024, questions: [] };
  await withStubs(
    { fetch: async (url) => (url.includes('id=eq.fresh') ? json([{ parser_version: PARSER_VERSION, exam }]) : json([{ parser_version: PARSER_VERSION - 1, exam }])) },
    async () => {
      assert.deepStrictEqual(await store.getExam('fresh'), exam);
      assert.strictEqual(await store.getExam('stale'), null);
    }
  );
});

test('putExam upserts the exam stamped with the parser version, using the secret key', async () => {
  let call;
  await withStubs(
    { fetch: async (url, opts) => { call = { url, opts }; return { ok: true, status: 201 }; } },
    async () => {
      await store.putExam('summer_2024', { questions: [] });
      assert.match(call.url, /\/rest\/v1\/exams$/);
      assert.strictEqual(call.opts.method, 'POST');
      assert.strictEqual(call.opts.headers.Authorization, 'Bearer sb_secret_test');
      assert.match(call.opts.headers.Prefer, /merge-duplicates/);
      assert.deepStrictEqual(JSON.parse(call.opts.body), [{ id: 'summer_2024', parser_version: PARSER_VERSION, exam: { questions: [] } }]);
    }
  );
});

test('an unreachable database reads as a miss rather than an error', async () => {
  await withStubs({ fetch: async () => { throw new Error('ECONNREFUSED'); } }, async () => {
    assert.strictEqual(await store.getExam('summer_2024'), null);
    assert.strictEqual(await store.getExplanation('summer_2024', 'First-1'), null);
    await store.putExam('summer_2024', {});
  });
  await withStubs({ fetch: async () => ({ ok: false, status: 503 }) }, async () => {
    assert.strictEqual(await store.getExam('summer_2024'), null);
  });
});

test('with no Supabase configured nothing is ever requested', async () => {
  await withStubs({ configured: false, fetch: () => assert.fail('must not call fetch') }, async () => {
    assert.strictEqual(store.configured(), false);
    assert.strictEqual(await store.getExam('summer_2024'), null);
    assert.strictEqual(await store.getExplanation('summer_2024', 'First-1'), null);
    await store.putExplanation('summer_2024', 'First-1', 'x');
  });
});

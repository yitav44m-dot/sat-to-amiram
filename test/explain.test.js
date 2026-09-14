'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { explainQuestion, buildPrompt, ExplainerUnavailableError, ExplainerBusyError } = require('../server/explain');

// A sitting that will never exist, so the cache file this writes can be
// thrown away without touching real explanations.
const SITTING = { season: 'spring', year: 2099 };
const CACHE = path.join(__dirname, '..', 'data', 'explanations', 'spring_2099.json');

const question = {
  section: 'First',
  number: 3,
  type: 'sentence-completion',
  prompt: 'According to world aviation officials, 2017 was ________ to date for commercial air travel.',
  options: ['the safest year', 'safely considered', 'particularly safe', 'a safer year'],
  correctIndex: 0,
};

const geminiReply = (text) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
});

function withStubs({ key = 'test-key', fetch: handler }, run) {
  const realFetch = global.fetch;
  const realKey = process.env.GEMINI_API_KEY;
  global.fetch = handler;
  if (key) process.env.GEMINI_API_KEY = key;
  else delete process.env.GEMINI_API_KEY;
  fs.rmSync(CACHE, { force: true });
  return Promise.resolve()
    .then(run)
    .finally(() => {
      global.fetch = realFetch;
      if (realKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = realKey;
      fs.rmSync(CACHE, { force: true });
    });
}

test('the prompt carries the stem, every option and the key, and the passage when there is one', () => {
  const prompt = buildPrompt(question);
  assert.match(prompt, /2017 was ________ to date/);
  for (let i = 0; i < 4; i++) assert.ok(prompt.includes(`(${i + 1}) ${question.options[i]}`));
  assert.match(prompt, /התשובה הנכונה: \(1\)/);
  assert.doesNotMatch(prompt, /הקטע:/);

  const rc = { ...question, passage: ['[[1]] First paragraph.', '[[5]] Second paragraph.'] };
  const rcPrompt = buildPrompt(rc);
  assert.match(rcPrompt, /הקטע:\nFirst paragraph\.\n\nSecond paragraph\./);
});

test('an explanation is fetched once and then served from the cache', async () => {
  let calls = 0;
  await withStubs(
    {
      fetch: async (url, opts) => {
        calls++;
        assert.match(url, /generateContent$/);
        assert.strictEqual(opts.headers['x-goog-api-key'], 'test-key');
        return geminiReply('  הסבר לדוגמה  ');
      },
    },
    async () => {
      assert.strictEqual(await explainQuestion(question, SITTING), 'הסבר לדוגמה');
      assert.strictEqual(await explainQuestion(question, SITTING), 'הסבר לדוגמה');
      assert.strictEqual(calls, 1);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(CACHE, 'utf8')), { 'First-3': 'הסבר לדוגמה' });
    }
  );
});

test('simultaneous requests for one uncached question share a single API call', async () => {
  let calls = 0;
  await withStubs(
    {
      fetch: () => {
        calls++;
        return new Promise((resolve) => setTimeout(() => resolve(geminiReply('אחד')), 20));
      },
    },
    async () => {
      const [a, b] = await Promise.all([explainQuestion(question, SITTING), explainQuestion(question, SITTING)]);
      assert.strictEqual(a, 'אחד');
      assert.strictEqual(b, 'אחד');
      assert.strictEqual(calls, 1);
    }
  );
});

test('no API key is the unavailable error, and a quota hit is the busy error - neither is cached', async () => {
  await withStubs({ key: null, fetch: () => assert.fail('must not call the API without a key') }, async () => {
    await assert.rejects(explainQuestion(question, SITTING), ExplainerUnavailableError);
  });
  await withStubs({ fetch: async () => ({ ok: false, status: 429, json: async () => ({}) }) }, async () => {
    await assert.rejects(explainQuestion(question, SITTING), ExplainerBusyError);
    assert.ok(!fs.existsSync(CACHE));
  });
});

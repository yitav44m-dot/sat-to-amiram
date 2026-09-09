'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { getExamRawText, NoExamPdfError } = require('../server/fetchExam');

// A sitting with no PDF on disk, so every case here goes down the fetch
// path without touching the cached real exams.
const SEASON = 'spring';
const YEAR = 2099;
const PDF_PATH = path.join(__dirname, '..', 'data', 'pdfs', `${SEASON}_${YEAR}.pdf`);

function withStubbedFetch(handler, run) {
  const realFetch = global.fetch;
  const realError = console.error;
  global.fetch = handler;
  console.error = () => {};
  return Promise.resolve()
    .then(run)
    .finally(() => {
      global.fetch = realFetch;
      console.error = realError;
    });
}

const headOk = () => ({ ok: true });

test('a download that dies on the wire reads as an unavailable sitting, not a raw fetch error', async () => {
  // undici throws TypeError: fetch failed for every transport-level
  // failure and hides the reason in err.cause. Surfacing that verbatim
  // put "fetch failed" in front of the user, in English, in an otherwise
  // Hebrew UI, describing something they can do nothing about.
  await withStubbedFetch(
    (url, opts) => {
      if (opts?.method === 'HEAD') return Promise.resolve(headOk());
      const err = new TypeError('fetch failed');
      err.cause = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
      return Promise.reject(err);
    },
    async () => {
      await assert.rejects(getExamRawText(SEASON, YEAR), { name: 'NoExamPdfError' });
      assert.ok(!fs.existsSync(PDF_PATH), 'a failed download must not leave a file behind');
    }
  );
});

test('a non-OK status on the download reads the same way', async () => {
  await withStubbedFetch(
    (url, opts) => Promise.resolve(opts?.method === 'HEAD' ? headOk() : { ok: false, status: 502 }),
    async () => {
      await assert.rejects(getExamRawText(SEASON, YEAR), { name: 'NoExamPdfError' });
      assert.ok(!fs.existsSync(PDF_PATH), 'a failed download must not leave a file behind');
    }
  );
});

test('a sitting NITE never published is the same error as one that would not download', async () => {
  // Both mean "you cannot practice this sitting", which is the only thing
  // the picker can usefully say, so they share one error and one message.
  await withStubbedFetch(
    () => Promise.resolve({ ok: false, status: 404 }),
    async () => {
      const err = await getExamRawText(SEASON, YEAR).then(() => null, (e) => e);
      assert.ok(err instanceof NoExamPdfError);
    }
  );
});

'use strict';

const { PARSER_VERSION } = require('./parser');

// Durable cache in Supabase, behind the on-disk one. On Render the disk is
// wiped by every deploy and idle spin-down, so without this each exam was
// re-downloaded from NITE and re-parsed several times a day, and every
// Gemini explanation regenerated after each restart.
//
// Only the server talks to Supabase, with its secret key; nothing here is
// reachable from the page. And nothing here is load-bearing: when the
// project is unconfigured (a local checkout, the tests) or unreachable
// (Supabase pauses idle free projects), every call reports a miss and the
// caller carries on as if there were no database.
function configured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

async function request(method, table, query, body) {
  const base = process.env.SUPABASE_URL.replace(/\/+$/, '');
  const url = `${base}/rest/v1/${table}${query ? `?${query}` : ''}`;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'resolution=merge-duplicates,return=minimal' : '',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${table}: HTTP ${res.status}`);
  return method === 'GET' ? res.json() : null;
}

async function attempt(label, fn) {
  if (!configured()) return null;
  try {
    return await fn();
  } catch (err) {
    console.error(`[store] ${label}:`, err.message);
    return null;
  }
}

// An exam stored by an older parser is treated as absent, so a parse fix
// reaches users on their next load instead of being shadowed by the cache.
async function getExam(id) {
  return attempt(`get exam ${id}`, async () => {
    const rows = await request('GET', 'exams', `id=eq.${id}&select=parser_version,exam`);
    const row = rows[0];
    return row && row.parser_version === PARSER_VERSION ? row.exam : null;
  });
}

async function putExam(id, exam) {
  await attempt(`put exam ${id}`, () =>
    request('POST', 'exams', '', [{ id, parser_version: PARSER_VERSION, exam }])
  );
}

async function getExplanation(examId, questionId) {
  return attempt(`get explanation ${examId} ${questionId}`, async () => {
    const rows = await request(
      'GET', 'explanations', `exam_id=eq.${examId}&question_id=eq.${questionId}&select=text`
    );
    return rows[0]?.text || null;
  });
}

async function putExplanation(examId, questionId, text) {
  await attempt(`put explanation ${examId} ${questionId}`, () =>
    request('POST', 'explanations', '', [{ exam_id: examId, question_id: questionId, text }])
  );
}

module.exports = { configured, getExam, putExam, getExplanation, putExplanation };

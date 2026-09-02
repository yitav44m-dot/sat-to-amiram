'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseEnglishExam, stripNoise, splitEnglishSections } = require('../server/parser');

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'synthetic_exam.txt'), 'utf8');
const KEYS = { First: '14231342431', Second: '12142124121' };

const parse = (text = FIXTURE) => parseEnglishExam(text, { season: 'summer', year: 2025 });
const bySection = (exam, label) => exam.questions.filter((q) => q.section === label);
const allStrings = (exam) =>
  exam.questions.flatMap((q) => [q.prompt, q.passage || '', ...q.options]);

test('parses every question in both sections, in order', () => {
  const exam = parse();
  assert.strictEqual(exam.questionCount, 22);
  assert.strictEqual(exam.questions.length, 22);
  assert.deepStrictEqual(
    exam.questions.map((q) => `${q.section}${q.number}`),
    [...Array(11).keys()].map((i) => `First${i + 1}`).concat(
      [...Array(11).keys()].map((i) => `Second${i + 1}`)
    )
  );
});

test('classifies question types by part', () => {
  const exam = parse();
  for (const label of ['First', 'Second']) {
    const types = bySection(exam, label).map((q) => q.type);
    assert.deepStrictEqual(types.slice(0, 3), Array(3).fill('sentence-completion'));
    assert.deepStrictEqual(types.slice(3, 5), Array(2).fill('restatement'));
    assert.deepStrictEqual(types.slice(5), Array(6).fill('reading-comprehension'));
  }
});

test('every question has four non-empty options', () => {
  for (const q of parse().questions) {
    assert.strictEqual(q.options.length, 4, `question ${q.section}${q.number}`);
    for (const opt of q.options) assert.ok(opt.trim().length > 0);
  }
});

test('attaches the answer key digit for each question', () => {
  const exam = parse();
  for (const label of ['First', 'Second']) {
    assert.deepStrictEqual(
      bySection(exam, label).map((q) => q.correctIndex),
      KEYS[label].split('').map((d) => Number(d) - 1)
    );
  }
});

test('strips page footers, copyright boilerplate and the trailing appendix', () => {
  for (const s of allStrings(parse())) {
    assert.doesNotMatch(s, /Copyright|may not be taught|NATIONAL INSTITUTE|First Section|Second Section/);
  }
});

test('the last question of a section does not absorb the appendix', () => {
  const last = parse().questions.at(-1);
  assert.strictEqual(last.number, 11);
  assert.strictEqual(last.options[0], 'an appendix');
  for (const opt of last.options) assert.ok(opt.length < 60, `runaway option: ${opt.slice(0, 80)}`);
});

test('reading comprehension questions carry a cleaned passage', () => {
  const rc = parse().questions.filter((q) => q.type === 'reading-comprehension');
  assert.strictEqual(rc.length, 12);
  for (const q of rc) {
    assert.ok(q.passage && q.passage.length > 40, `missing passage on ${q.section}${q.number}`);
    assert.doesNotMatch(q.passage, /^\(\d+\)/);
    assert.doesNotMatch(q.passage, /\n/);
  }
  const first = rc.find((q) => q.section === 'First' && q.number === 6);
  const second = rc.find((q) => q.section === 'First' && q.number === 9);
  assert.notStrictEqual(first.passage, second.passage);
});

test('recovers questions when the "Questions" heading has stray column text glued on', () => {
  const glued = parse().questions.filter(
    (q) => q.section === 'Second' && q.type === 'reading-comprehension' && q.number >= 9
  );
  assert.deepStrictEqual(glued.map((q) => q.number), [9, 10, 11]);
  for (const s of allStrings(parse())) assert.doesNotMatch(s, /than the use of X-ray/);
});

test('converts the extractor\u2019s replacement character into an en dash', () => {
  const exam = parse();
  for (const s of allStrings(exam)) assert.doesNotMatch(s, /\uFFFD/);
  const dashed = exam.questions.find((q) => q.section === 'First' && q.number === 6);
  assert.match(dashed.passage, /em dash \u2013 to check/);
});

test('parses identically with CRLF line endings', () => {
  const crlf = parse(FIXTURE.replace(/\n/g, '\r\n'));
  assert.deepStrictEqual(crlf, parse());
});

test('stripNoise drops standalone page numbers but keeps option lines', () => {
  const out = stripNoise('1. A stem\n\n   9\n\n(1) an option\n');
  assert.doesNotMatch(out, /^\s*9\s*$/m);
  assert.match(out, /\(1\) an option/);
});

test('splitEnglishSections rejects text with fewer than two section markers', () => {
  assert.throws(
    () => splitEnglishSections('ENGLISH\nThis section contains 22 questions.\n'),
    /found 1/
  );
});

test('renders a sentence-completion blank as a visible marker, not a swallowed space', () => {
  const q = parse().questions.find((x) => x.section === 'First' && x.number === 1);
  assert.strictEqual(q.prompt, 'A good fixture helps a parser ________ hidden regressions.');
});

test('does not insert a blank marker at a wrapped line\u2019s leading indentation', () => {
  const wrapped =
    '1. This sentence intentionally wraps right at a normal\n\n' +
    '       margin, with no missing word anywhere in it.\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n';
  const exam = parse(FIXTURE.replace(/1\. A good fixture[\s\S]*?\(4\) recall\n/, `${wrapped}\n`));
  const q = exam.questions.find((x) => x.section === 'First' && x.number === 1);
  assert.doesNotMatch(q.prompt, /_____/);
});

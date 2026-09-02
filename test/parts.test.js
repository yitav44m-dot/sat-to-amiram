'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildParts, PART_TYPES } = require('../public/amiram.js');
const { parseEnglishExam } = require('../server/parser');

function pool({ sc = 0, rs = 0, texts = 0, perText = 5 }) {
  const questions = [];
  for (let i = 0; i < sc; i++) questions.push({ type: 'sentence-completion', number: i + 1 });
  for (let i = 0; i < rs; i++) questions.push({ type: 'restatement', number: i + 1 });
  for (let t = 0; t < texts; t++) {
    for (let i = 0; i < perText; i++) {
      questions.push({ type: 'reading-comprehension', passage: `passage ${t}`, number: i + 1 });
    }
  }
  return questions;
}

const shape = (parts) => parts.map((p) => `${p.type[0]}${p.indices.length}`);

const FULL_POOL = () => pool({ sc: 16, rs: 8, texts: 4, perText: 5 });

test('the Amiram simulation is exactly six chapters, in the fixed order', () => {
  const parts = buildParts(FULL_POOL());
  assert.strictEqual(parts.length, 6);
  assert.deepStrictEqual(shape(parts), ['s4', 's4', 'r5', 'r3', 'r3', 's4']);
  assert.deepStrictEqual(
    parts.map((p) => p.title),
    [
      'Sentence Completions', 'Sentence Completions', 'Reading Comprehension',
      'Restatements', 'Restatements', 'Sentence Completions',
    ]
  );
});

test('any parsed questions beyond the six chapters are left unused', () => {
  const questions = FULL_POOL();
  const used = buildParts(questions).flatMap((p) => p.indices);
  assert.strictEqual(used.length, 4 + 4 + 5 + 3 + 3 + 4);
  assert.strictEqual(new Set(used).size, used.length);
  assert.ok(used.length < questions.length, 'a 44-question exam has leftovers past six chapters');
});

test('each part carries its own title and instructions', () => {
  for (const part of buildParts(FULL_POOL())) {
    assert.strictEqual(part.title, PART_TYPES[part.type].title);
    assert.strictEqual(part.instructions, PART_TYPES[part.type].instructions);
    assert.ok(part.instructions.length > 60);
  }
});

test('a reading part is exactly one passage; other parts carry none', () => {
  const questions = FULL_POOL();
  for (const part of buildParts(questions)) {
    if (part.type !== 'reading-comprehension') {
      assert.strictEqual(part.passage, null);
      continue;
    }
    const passages = new Set(part.indices.map((i) => questions[i].passage));
    assert.strictEqual(passages.size, 1);
    assert.strictEqual(part.passage, [...passages][0]);
  }
});

test('keeps questions in exam order within a part', () => {
  for (const part of buildParts(FULL_POOL())) {
    assert.deepStrictEqual(part.indices, [...part.indices].sort((a, b) => a - b));
  }
});

test('a chapter with fewer source questions than the template asks for is shortened, not skipped', () => {
  assert.deepStrictEqual(shape(buildParts(pool({ sc: 2 }))), ['s2']);
  assert.deepStrictEqual(shape(buildParts(pool({ rs: 1 }))), ['r1']);
  assert.deepStrictEqual(shape(buildParts(pool({ texts: 1, perText: 3 }))), ['r3']);
  assert.deepStrictEqual(buildParts([]), []);
});

test('covers the parsed fixture exam within its six chapters', () => {
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'synthetic_exam.txt'), 'utf8');
  const exam = parseEnglishExam(fixture, { season: 'summer', year: 2025 });
  const parts = buildParts(exam.questions);
  assert.deepStrictEqual(shape(parts), ['s4', 's2', 'r3', 'r3', 'r1']);
});

test('numbers repeated chapter types with their own ordinal (1st SC, 2nd SC, ...)', () => {
  const parts = buildParts(FULL_POOL());
  const labels = parts.map((p) => `${p.titleHe} ${p.ordinal}`);
  assert.deepStrictEqual(labels, [
    'השלמת משפטים 1',
    'השלמת משפטים 2',
    'הבנת הנקרא 1',
    'ניסוח מחדש 1',
    'ניסוח מחדש 2',
    'השלמת משפטים 3',
  ]);
});

test('carries the Hebrew chrome the UI renders for each part', () => {
  for (const part of buildParts(FULL_POOL())) {
    const meta = PART_TYPES[part.type];
    assert.strictEqual(part.titleHe, meta.titleHe);
    assert.strictEqual(part.heading, meta.heading);
    assert.strictEqual(part.icon, meta.icon);
    assert.ok(part.heading.endsWith(':'), `heading should read as a prompt: ${part.heading}`);
    assert.ok(['book', 'brain', 'cap'].includes(part.icon));
  }
});

test('budgets a fixed time per chapter type, regardless of how many questions land in it', () => {
  const parts = buildParts(FULL_POOL());
  const seconds = Object.fromEntries(parts.map((p) => [`${p.type}-${p.ordinal}`, p.seconds]));
  assert.strictEqual(seconds['sentence-completion-1'], 4 * 60);
  assert.strictEqual(seconds['sentence-completion-2'], 4 * 60);
  assert.strictEqual(seconds['sentence-completion-3'], 4 * 60);
  assert.strictEqual(seconds['restatement-1'], 6 * 60);
  assert.strictEqual(seconds['restatement-2'], 6 * 60);
  assert.strictEqual(seconds['reading-comprehension-1'], 15 * 60);

  // A short chapter (fewer questions than the template asks for) still gets
  // the full flat budget for its type.
  const short = buildParts(pool({ sc: 2 }))[0];
  assert.strictEqual(short.indices.length, 2);
  assert.strictEqual(short.seconds, 4 * 60);
});

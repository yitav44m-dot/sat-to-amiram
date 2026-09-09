'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildParts, PART_TYPES, amirnetScore } = require('../public/amiram.js');
const { parseEnglishExam } = require('../server/parser');

function pool({ sc = 0, rs = 0, texts = 0, perText = 5 }) {
  const questions = [];
  for (let i = 0; i < sc; i++) {
    questions.push({ type: 'sentence-completion', section: i < sc / 2 ? 'First' : 'Second', number: i + 1 });
  }
  for (let i = 0; i < rs; i++) {
    questions.push({ type: 'restatement', section: i < rs / 2 ? 'First' : 'Second', number: i + 1 });
  }
  for (let t = 0; t < texts; t++) {
    // Two texts per section, the way a real exam is laid out.
    const section = t < 2 ? 'First' : 'Second';
    for (let i = 0; i < perText; i++) {
      questions.push({
        type: 'reading-comprehension',
        section,
        passage: [`passage ${t}`],
        number: i + 1,
      });
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
    const passages = part.indices.map((i) => questions[i].passage);
    for (const passage of passages) assert.deepStrictEqual(passage, part.passage);
  }
});

test('the sixth chapter draws the second section’s 5-8, not its 1-4', () => {
  // Eight sentence completions per section, twelve slots. The first two
  // chapters take the first section whole; the surplus comes off the front
  // of the second section, so the last chapter gets its back half.
  const questions = pool({ sc: 16 });
  const chapters = buildParts(questions)
    .filter((p) => p.type === 'sentence-completion')
    .map((p) => p.indices.map((i) => `${questions[i].section} ${questions[i].number}`));

  assert.deepStrictEqual(chapters, [
    ['First 1', 'First 2', 'First 3', 'First 4'],
    ['First 5', 'First 6', 'First 7', 'First 8'],
    ['Second 13', 'Second 14', 'Second 15', 'Second 16'],
  ]);
});

test('deals a short sentence-completion pool whole rather than trimming it', () => {
  assert.deepStrictEqual(shape(buildParts(pool({ sc: 6 }))), ['s4', 's2']);
});

test('the restatement chapters skip each section’s opening question', () => {
  // Four restatements per section (9-12 in a real exam) and room for six, so
  // the opener of each is dropped: 10-12 from First, then 10-12 from Second.
  // Taking the first six in exam order instead would run 9-11 from First and
  // then straddle the section boundary with 12, 9, 10.
  const questions = pool({ rs: 8 });
  const chapters = buildParts(questions)
    .filter((p) => p.type === 'restatement')
    .map((p) => p.indices.map((i) => `${questions[i].section} ${questions[i].number}`));

  assert.deepStrictEqual(chapters, [
    ['First 2', 'First 3', 'First 4'],
    ['Second 6', 'Second 7', 'Second 8'],
  ]);
});

test('deals a short restatement pool whole rather than starving it to skip openers', () => {
  assert.deepStrictEqual(shape(buildParts(pool({ rs: 1 }))), ['r1']);
  assert.deepStrictEqual(shape(buildParts(pool({ rs: 4 }))), ['r3', 'r1']);
});

test('the reading chapter is always a section’s second text, never its first', () => {
  // Two texts per section, so "passage 1" (First) and "passage 3" (Second)
  // are the second ones. Repeated because the pick is random.
  const chosen = new Set();
  for (let i = 0; i < 60; i++) {
    const questions = FULL_POOL();
    const part = buildParts(questions).find((p) => p.type === 'reading-comprehension');
    chosen.add(part.passage[0]);
  }
  assert.deepStrictEqual([...chosen].sort(), ['passage 1', 'passage 3']);
});

test('falls back to the only text there is when no section has a second one', () => {
  const part = buildParts(pool({ texts: 1, perText: 3 }))[0];
  assert.deepStrictEqual(part.passage, ['passage 0']);
});

test('groups a passage’s questions correctly even after a JSON cache round-trip', () => {
  // The server caches a parsed exam to disk as JSON and reloads it on the
  // next request. JSON.parse always builds fresh array instances, even for
  // passages that were the exact same array reference before being cached -
  // grouping must compare passage content, not identity, or every cached
  // exam's reading-comprehension questions fracture into one-question parts.
  const roundTripped = JSON.parse(JSON.stringify({ questions: FULL_POOL() })).questions;
  const parts = buildParts(roundTripped);
  const rcParts = parts.filter((p) => p.type === 'reading-comprehension');
  assert.strictEqual(rcParts.length, 1);
  assert.strictEqual(rcParts[0].indices.length, 5);
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

test('amirnetScore maps correct/total onto the 50-150 scale, rounded', () => {
  assert.strictEqual(amirnetScore(18, 23), 128); // the worked example in the spec
  assert.strictEqual(amirnetScore(0, 23), 50);
  assert.strictEqual(amirnetScore(23, 23), 150);
  assert.strictEqual(amirnetScore(12, 23), 50 + Math.round((12 / 23) * 100));
});

test('amirnetScore never leaves the 50-150 range', () => {
  for (let correct = 0; correct <= 23; correct++) {
    const score = amirnetScore(correct, 23);
    assert.ok(score >= 50 && score <= 150, `score ${score} out of range for ${correct}/23`);
  }
});

test('amirnetScore treats a zero-question exam as the floor score, not a division error', () => {
  assert.strictEqual(amirnetScore(0, 0), 50);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseEnglishExam, stripNoise, splitEnglishSections, hasEnglishSection } = require('../server/parser');

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'synthetic_exam.txt'), 'utf8');
const KEYS = { First: '14231342431', Second: '12142124121' };

const parse = (text = FIXTURE, tableText) =>
  parseEnglishExam(text, { season: 'summer', year: 2025 }, tableText);
const bySection = (exam, label) => exam.questions.filter((q) => q.section === label);
const allStrings = (exam) =>
  exam.questions.flatMap((q) => [q.prompt, ...(q.passage || []), ...q.options]);

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

test('reading comprehension questions carry a cleaned passage as an array of paragraphs', () => {
  const rc = parse().questions.filter((q) => q.type === 'reading-comprehension');
  assert.strictEqual(rc.length, 12);
  for (const q of rc) {
    assert.ok(Array.isArray(q.passage) && q.passage.length > 0, `missing passage on ${q.section}${q.number}`);
    const joined = q.passage.join(' ');
    assert.ok(joined.length > 40, `passage too short on ${q.section}${q.number}`);
    for (const paragraph of q.passage) {
      assert.doesNotMatch(paragraph, /^\(\d+\)/);
      assert.doesNotMatch(paragraph, /\n/);
      assert.ok(paragraph.trim().length > 0);
    }
  }
  const first = rc.find((q) => q.section === 'First' && q.number === 6);
  const second = rc.find((q) => q.section === 'First' && q.number === 9);
  assert.notStrictEqual(first.passage, second.passage);
  // NITE's own original line numbers survive, so RC questions that refer
  // back to a specific line ("the word in line 5") stay answerable.
  assert.match(first.passage[0], /^\[\[1\]\] /);
  assert.match(first.passage.join(' '), /\[\[5\]\]/);
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
  assert.match(dashed.passage.join(' '), /em dash \u2013 to check/);
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

test('an exam form with no English section at all is its own error, not a parse failure', () => {
  // Distinct from the "found 1" case above: one marker means something
  // went wrong reading a form that does have English, while none means
  // NITE published a form without it (autumn 2024). Only the second is a
  // sitting the user should simply be told to skip.
  assert.throws(() => splitEnglishSections('Hebrew-only booklet, no English at all.\n'), {
    name: 'NoEnglishSectionError',
  });
  assert.strictEqual(hasEnglishSection('Hebrew-only booklet, no English at all.\n'), false);
  assert.strictEqual(hasEnglishSection(FIXTURE), true);
});

test('hasEnglishSection looks past a page number splitting the section heading', () => {
  // stripNoise drops standalone page-number lines, which is the only
  // reason the heading reads as contiguous; testing the raw text instead
  // would report a complete exam as having no English section.
  assert.strictEqual(hasEnglishSection('ENGLISH\n   36   \nThis section contains 22 questions.\n'), true);
});

test('renders a sentence-completion blank as a visible marker, not a swallowed space', () => {
  const q = parse().questions.find((x) => x.section === 'First' && x.number === 1);
  assert.strictEqual(q.prompt, 'A good fixture helps a parser ________ hidden regressions.');
});

test('a wrapped line\u2019s leading indentation is not read as the blank\u2019s position', () => {
  const wrapped =
    '1. This sentence intentionally wraps right at a normal\n\n' +
    '       margin, and its missing word was lost without a trace.\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n';
  const exam = parse(FIXTURE.replace(/1\. A good fixture[\s\S]*?\(4\) recall\n/, `${wrapped}\n`));
  const q = exam.questions.find((x) => x.section === 'First' && x.number === 1);
  // No blank is recoverable here, so the fallback still shows one (every real
  // sentence-completion question has exactly one blank) \u2014 but at the end of
  // the sentence, not conjured mid-sentence from the wrap's indentation.
  assert.strictEqual(
    q.prompt,
    'This sentence intentionally wraps right at a normal margin, and its missing word was lost without a trace ________.'
  );
});

test('recovers a blank swallowed right before the closing period', () => {
  const swallowed =
    '1. Sir Arthur Conan Doyle was a physician by .\n\n' +
    '(1) provision\n(2) procession\n(3) promotion\n(4) profession\n';
  const exam = parse(FIXTURE.replace(/1\. A good fixture[\s\S]*?\(4\) recall\n/, `${swallowed}\n`));
  const q = exam.questions.find((x) => x.section === 'First' && x.number === 1);
  assert.strictEqual(q.prompt, 'Sir Arthur Conan Doyle was a physician by ________.');
});

test('still shows a blank when the extracted text has no trace of one at all', () => {
  const noTrace =
    '1. This clause used dot-like brushstrokes later the pointillist school of painting.\n\n' +
    '(1) a\n(2) associated with\n(3) c\n(4) d\n';
  const exam = parse(FIXTURE.replace(/1\. A good fixture[\s\S]*?\(4\) recall\n/, `${noTrace}\n`));
  const q = exam.questions.find((x) => x.section === 'First' && x.number === 1);
  assert.match(q.prompt, /________\.$/);
});

test('does not force a blank onto restatement or reading-comprehension stems', () => {
  const exam = parse();
  const nonSc = exam.questions.filter((q) => q.type !== 'sentence-completion');
  assert.ok(nonSc.length > 0);
  for (const q of nonSc) assert.doesNotMatch(q.prompt, /________/);
});

test('recovers a blank\u2019s true mid-sentence position from a table-mode cross-reference', () => {
  const swallowed =
    '1. This clause used dot-like brushstrokes later the pointillist school of painting.\n\n' +
    '(1) a\n(2) associated with\n(3) c\n(4) d\n';
  const layoutText = FIXTURE.replace(/1\. A good fixture[\s\S]*?\(4\) recall\n/, `${swallowed}\n`);

  // Table mode (pdftotext -table) preserves the blank as a wide run of
  // spaces wherever it actually falls, unlike layout mode which can lose it
  // without a trace when it's mid-sentence.
  const tableSwallowed =
    '1. This clause used dot-like brushstrokes later          the pointillist school of painting.\n\n' +
    '(1) a\n(2) associated with\n(3) c\n(4) d\n';
  const tableText = FIXTURE.replace(/1\. A good fixture[\s\S]*?\(4\) recall\n/, `${tableSwallowed}\n`);

  const withTable = parse(layoutText, tableText).questions.find(
    (x) => x.section === 'First' && x.number === 1
  );
  assert.strictEqual(
    withTable.prompt,
    'This clause used dot-like brushstrokes later ________ the pointillist school of painting.'
  );

  // Without the table-mode cross-reference, the same layout text still falls
  // back to appending the blank at the sentence's end.
  const withoutTable = parse(layoutText).questions.find(
    (x) => x.section === 'First' && x.number === 1
  );
  assert.match(withoutTable.prompt, /painting ________\.$/);
});

test('splits a reading-comprehension passage into its original paragraphs', () => {
  const multiParagraph =
    'Text I (Questions 6-8)\n\n' +
    '(1) This is the opening paragraph of an invented passage. It keeps going onto a\n' +
    '       second physical line to exercise line-wrap handling within one paragraph, and\n' +
    '(5) a third line, after a mid-paragraph line-number marker, stays part of it too.\n\n' +
    ' This is the second paragraph, indented by a single space the way NITE\n' +
    '       marks a genuine new paragraph, distinct from a wrapped continuation line.\n\n' +
    ' This is the third paragraph, also opening with that same single-space indent.\n' +
    '       Its own continuation line uses the usual deeper indent.\n\n' +
    'Questions\n\n' +
    '6. A question about the passage -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n' +
    '7. Another question -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n' +
    '8. A third question -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n';

  const original = /Text I \(Questions 6-8\)[\s\S]*?\(4\) describe the dash\n/;
  const exam = parse(FIXTURE.replace(original, multiParagraph));
  const q = exam.questions.find((x) => x.section === 'First' && x.number === 6);

  assert.deepStrictEqual(q.passage, [
    '[[1]] This is the opening paragraph of an invented passage. It keeps going onto a ' +
      'second physical line to exercise line-wrap handling within one paragraph, and ' +
      '[[5]] a third line, after a mid-paragraph line-number marker, stays part of it too.',
    'This is the second paragraph, indented by a single space the way NITE ' +
      'marks a genuine new paragraph, distinct from a wrapped continuation line.',
    'This is the third paragraph, also opening with that same single-space indent. ' +
      'Its own continuation line uses the usual deeper indent.',
  ]);
});

test('splits a passage whose paragraphs open wider than their continuation lines', () => {
  // The opposite convention from the usual one-space paragraph indent: in
  // winter 2023's first-section Text I, pdftotext renders the paragraph
  // opening at column 12 while continuation lines sit at 7. An absolute
  // "a paragraph starts at column <= 2" rule reads the whole passage as a
  // single paragraph.
  const wideIndent =
    'Text I (Questions 6-8)\n\n' +
    '(1) This is the opening paragraph of an invented passage, which runs on for\n' +
    '       a couple of lines indented at the usual continuation column.\n\n' +
    '            This second paragraph opens at a much deeper column than the lines\n' +
    '       that wrap after it, which is the whole point of this fixture.\n\n' +
    'Questions\n\n' +
    '6. A question about the passage -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n' +
    '7. Another question -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n' +
    '8. A third question -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n';

  const original = /Text I \(Questions 6-8\)[\s\S]*?\(4\) describe the dash\n/;
  const exam = parse(FIXTURE.replace(original, wideIndent));
  const q = exam.questions.find((x) => x.section === 'First' && x.number === 6);

  assert.deepStrictEqual(q.passage, [
    '[[1]] This is the opening paragraph of an invented passage, which runs on for ' +
      'a couple of lines indented at the usual continuation column.',
    'This second paragraph opens at a much deeper column than the lines ' +
      'that wrap after it, which is the whole point of this fixture.',
  ]);
});

test('drops the page furniture a Hebrew-form sitting leaves at the end of a passage', () => {
  // A passage block runs to the "Questions" heading, so it swallows the
  // copyright notice, the 'may not be copied' line and the page footer in
  // between. On a Hebrew-form sitting those are Hebrew, and these PDFs’ fonts
  // carry no usable character map, so the letters extract as nothing and only
  // a punctuation skeleton is left - which reads as three more paragraphs.
  const trailingFurniture =
    'Text I (Questions 6-8)\n\n' +
    '(1) This is the whole of an invented passage, which ends properly here.\n\n' +
    '                                        )"(        –)\n' +
    '        -     -   ,\n' +
    '2025    - 40 -    -\n\n' +
    'Questions\n\n' +
    '6. A question about the passage -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n' +
    '7. Another question -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n' +
    '8. A third question -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n';

  const original = /Text I \(Questions 6-8\)[\s\S]*?\(4\) describe the dash\n/;
  const exam = parse(FIXTURE.replace(original, trailingFurniture));
  const q = exam.questions.find((x) => x.section === 'First' && x.number === 6);

  assert.deepStrictEqual(q.passage, [
    '[[1]] This is the whole of an invented passage, which ends properly here.',
  ]);
});

test('keeps a marker line whose only content is a year, not just page furniture', () => {
  // "(25) 1999." is the real last line of summer 2026's first passage. It
  // has no letter in it either, so the furniture filter has to let a marker
  // line through or it truncates the passage mid-sentence.
  const yearEnding =
    'Text I (Questions 6-8)\n\n' +
    '(1) She received the prestigious Kennedy Center Honors in 1996 and the\n' +
    '       National Medal of the Arts in\n\n' +
    '(25) 1999.\n\n' +
    'Questions\n\n' +
    '6. A question about the passage -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n' +
    '7. Another question -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n' +
    '8. A third question -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n';

  const original = /Text I \(Questions 6-8\)[\s\S]*?\(4\) describe the dash\n/;
  const exam = parse(FIXTURE.replace(original, yearEnding));
  const q = exam.questions.find((x) => x.section === 'First' && x.number === 6);

  assert.match(q.passage.join(' '), /National Medal of the Arts in \[\[25\]\] 1999\.$/);
});
test('detects a paragraph break that lands exactly on a line-number marker', () => {
  // NITE's line-number markers land every 5 lines regardless of paragraph
  // structure, independent of where paragraphs actually break. A marker
  // line is always at column 0, indistinguishable by indentation alone from
  // an ordinary marker that falls mid-paragraph - but the line before a
  // genuine break ends its sentence, while the line before a mid-paragraph
  // marker trails off with no terminal punctuation. Confirmed against a
  // real exam passage where this exact coincidence occurs.
  const coincidence =
    'Text I (Questions 6-8)\n\n' +
    '(1) This is the opening paragraph of an invented passage, long enough to run\n' +
    '       for a few lines before the next line-number marker comes up for air.\n\n' +
    '(5) This second paragraph unfortunately starts right on a marker line, but it\n' +
    '       is correctly read as a new paragraph, not a continuation of the first.\n\n' +
    'Questions\n\n' +
    '6. A question about the passage -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n' +
    '7. Another question -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n' +
    '8. A third question -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n';

  const original = /Text I \(Questions 6-8\)[\s\S]*?\(4\) describe the dash\n/;
  const exam = parse(FIXTURE.replace(original, coincidence));
  const q = exam.questions.find((x) => x.section === 'First' && x.number === 6);
  assert.deepStrictEqual(q.passage, [
    '[[1]] This is the opening paragraph of an invented passage, long enough to run ' +
      'for a few lines before the next line-number marker comes up for air.',
    '[[5]] This second paragraph unfortunately starts right on a marker line, but it ' +
      'is correctly read as a new paragraph, not a continuation of the first.',
  ]);
});

test('known trade-off: a marker landing right after any sentence end is read as a new paragraph, even mid-paragraph', () => {
  // The signal available is "the line before the marker ends a sentence" -
  // there's no way to tell "ends a sentence" apart from "ends the
  // paragraph" using layout alone. A marker that happens to land right
  // after a sentence boundary inside a longer, multi-sentence paragraph
  // will be read as a paragraph break even though it isn't one. Checked
  // against every marker in four real exam passages (21 markers total)
  // and this never actually fired on a false positive there, but it's a
  // real trade-off worth documenting rather than silently relying on.
  const midParagraphSentenceEnd =
    'Text I (Questions 6-8)\n\n' +
    '(1) This paragraph has more than one sentence in it. Here comes the second one,\n' +
    '       which happens to run right up against the next line-number marker.\n\n' +
    '(5) It reads as a new paragraph here, even though it is really the very same one,\n' +
    '       just because the previous line happened to end with a period.\n\n' +
    'Questions\n\n' +
    '6. A question about the passage -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n' +
    '7. Another question -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n' +
    '8. A third question -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n';

  const original = /Text I \(Questions 6-8\)[\s\S]*?\(4\) describe the dash\n/;
  const exam = parse(FIXTURE.replace(original, midParagraphSentenceEnd));
  const q = exam.questions.find((x) => x.section === 'First' && x.number === 6);
  assert.strictEqual(q.passage.length, 2);
});

test('does not fragment a passage when its continuation indent drifts across a page break', () => {
  // A real NITE quirk: pdftotext sometimes reconstructs a wrapped line's
  // indent one character narrower after a page break, even within the same
  // paragraph. A relative "indent < this passage's typical indent" rule
  // would misread every one of those lines as a new paragraph.
  const drifting =
    'Text I (Questions 6-8)\n\n' +
    '(1) This paragraph starts normally and continues for a while across several\n' +
    '       lines, all indented seven spaces, right up to the point where a marker line\n' +
    '(5) appears mid-sentence, still at column zero as always, and the sentence carries\n' +
    '       on across it without ever pausing for breath.\n\n' +
    '      Then a page break happens, and the next few lines of the SAME paragraph\n' +
    '      render one column narrower than before - six spaces instead of seven.\n\n' +
    '      This drift keeps going for the rest of the paragraph.\n\n' +
    'Questions\n\n' +
    '6. A question about the passage -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n' +
    '7. Another question -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n' +
    '8. A third question -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n';

  const original = /Text I \(Questions 6-8\)[\s\S]*?\(4\) describe the dash\n/;
  const exam = parse(FIXTURE.replace(original, drifting));
  const q = exam.questions.find((x) => x.section === 'First' && x.number === 6);

  assert.strictEqual(q.passage.length, 1);
  assert.match(q.passage[0], /six spaces instead of seven/);
  assert.match(q.passage[0], /rest of the paragraph\.$/);
});

test('recovers a blank at a line-wrap boundary from layout mode, with no table to fall back on', () => {
  // summer 2025, second section, question 5: the blank is the first thing
  // on the wrapped line, so it leaves no mid-line gap - only a leading
  // indent of 14 where an ordinary wrap in that block sits at 7. Table
  // mode renders the same wrap at its ordinary 4, so the cross-reference
  // cannot recover this one and the blank used to land at the very end
  // ("...found in along the Nile river ________.").
  const wrapBlank =
    '1. The ancient Egyptians had numerous uses for natron, a mixture of various salts found in\n\n' +
    '              along the Nile river.\n\n' +
    '(1) abundance\n(2) endurance\n(3) competence\n(4) defiance\n';
  const ordinaryWrap =
    '2. The invented sample text is the        of the real exam layout, wrapped\n\n' +
    '       onto a second line at the usual indent, and then onto a third\n\n' +
    "       line as well, so the block's ordinary wrap indent is measurable.\n\n" +
    '(1) forecaster\n(2) mirror\n(3) inspector\n(4) publisher\n';

  const layoutText = FIXTURE.replace(/1\. A good fixture[\s\S]*?\(4\) recall\n/, `${wrapBlank}\n`)
    .replace(/2\. The invented sample text[\s\S]*?\(4\) publisher\n/, ordinaryWrap);

  const q = parse(layoutText).questions.find((x) => x.section === 'First' && x.number === 1);
  assert.strictEqual(
    q.prompt,
    'The ancient Egyptians had numerous uses for natron, a mixture of various salts ' +
      'found in ________ along the Nile river.'
  );
});

test('recovers a blank that falls exactly at a line-wrap boundary via table-mode indent', () => {
  // Question 2 gets an ordinary two-line wrap purely so the block has a
  // baseline to measure question 1's wrap against; a block whose only
  // wrapped line is the blank itself can't be calibrated, and the parser
  // correctly declines to guess there.
  const ordinaryWrap = (indent) =>
    '2. The invented sample text is the        of the real exam layout, wrapped\n\n' +
    `${indent}onto a second line at the usual indent, and then onto a third\n\n` +
    `${indent}line as well, so the block's ordinary wrap indent is measurable.\n\n` +
    '(1) forecaster\n(2) mirror\n(3) inspector\n(4) publisher\n';
  const question2 = /2\. The invented sample text[\s\S]*?\(4\) publisher\n/;

  const swallowed =
    '1. The Fugger family, prominent bankers, used some of the wealth they had\n\n' +
    '       to build a housing project for the working poor.\n\n' +
    '(1) discouraged\n(2) accumulated\n(3) scheduled\n(4) consoled\n';
  const layoutText = FIXTURE.replace(/1\. A good fixture[\s\S]*?\(4\) recall\n/, `${swallowed}\n`)
    .replace(question2, ordinaryWrap('       '));

  // Layout mode puts question 1's wrap at the same indent as an ordinary
  // one, so nothing there marks it as a blank. Table mode keeps ordinary
  // wraps at a consistent ~4 and pushes this one out to 11, which is the
  // signal the cross-reference recovers the position from.
  const tableSwallowed =
    '1. The Fugger family, prominent bankers, used some of the wealth they had\n\n' +
    '           to build a housing project for the working poor.\n\n' +
    '(1) discouraged\n(2) accumulated\n(3) scheduled\n(4) consoled\n';
  const tableText = FIXTURE.replace(/1\. A good fixture[\s\S]*?\(4\) recall\n/, `${tableSwallowed}\n`)
    .replace(question2, ordinaryWrap('    '));

  const q = parse(layoutText, tableText).questions.find((x) => x.section === 'First' && x.number === 1);
  assert.strictEqual(
    q.prompt,
    'The Fugger family, prominent bankers, used some of the wealth they had ________ ' +
      'to build a housing project for the working poor.'
  );
});

test('recognizes a blank NITE already rendered as literal underscores, without doubling it', () => {
  const native =
    '1. Just three weeks after an event, the city named a street in memory of the _____ leader.\n\n' +
    '(1) slain\n(2) flung\n(3) drawn\n(4) wrung\n';
  const exam = parse(FIXTURE.replace(/1\. A good fixture[\s\S]*?\(4\) recall\n/, `${native}\n`));
  const q = exam.questions.find((x) => x.section === 'First' && x.number === 1);
  assert.strictEqual(
    q.prompt,
    'Just three weeks after an event, the city named a street in memory of the ________ leader.'
  );
  assert.strictEqual((q.prompt.match(/_{3,}/g) || []).length, 1);
});

test('drops a mid-word replacement character instead of fabricating a dash inside it', () => {
  // A mid-word U+FFFD is pdftotext losing a character it couldn't map to
  // Unicode (typically an accented letter in a foreign proper noun, e.g.
  // "Le�n" for "León") - not the em/en-dash pattern, which is always
  // flanked by whitespace. Confidently turning it into a dash would produce
  // fluent-looking but wrong text.
  const passage =
    'Text I (Questions 6-8)\n\n' +
    '(1) The chronicler Pedro de Cieza de Le\ufffdn documented the region, and the archaeologist\n' +
    '       Toribio Mej\ufffda Xesspe later studied it \ufffd carefully and thoroughly \ufffd over decades.\n\n' +
    'Questions\n\n' +
    '6. A question about the passage -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n' +
    '7. Another question -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n' +
    '8. A third question -\n\n' +
    '(1) a\n(2) b\n(3) c\n(4) d\n\n';

  const original = /Text I \(Questions 6-8\)[\s\S]*?\(4\) describe the dash\n/;
  const exam = parse(FIXTURE.replace(original, passage));
  const q = exam.questions.find((x) => x.section === 'First' && x.number === 6);

  assert.strictEqual(
    q.passage[0],
    '[[1]] The chronicler Pedro de Cieza de Len documented the region, and the archaeologist ' +
      'Toribio Meja Xesspe later studied it – carefully and thoroughly – over decades.'
  );
  assert.doesNotMatch(q.passage[0], /\uFFFD/);
});

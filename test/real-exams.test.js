'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseEnglishExam, hasEnglishSection } = require('../server/parser');

const PDF_DIR = path.join(__dirname, '..', 'data', 'pdfs');

function havePdftotext() {
  try {
    // pdftotext -v exits non-zero after printing its version, so only a
    // missing binary (ENOENT) counts as unavailable.
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
  } catch (err) {
    if (err.code === 'ENOENT') return false;
  }
  return true;
}

function pdfToText(pdfPath, mode) {
  const txtPath = path.join(os.tmpdir(), `${path.basename(pdfPath, '.pdf')}.${mode}.test.txt`);
  execFileSync('pdftotext', [`-${mode}`, pdfPath, txtPath]);
  const text = fs.readFileSync(txtPath, 'utf8');
  fs.unlinkSync(txtPath);
  return text;
}

const pdfs = fs.existsSync(PDF_DIR)
  ? fs.readdirSync(PDF_DIR).filter((f) => f.endsWith('.pdf'))
  : [];

// The exam PDFs are NITE's copyrighted material and are not committed, so these
// regression tests only run against whatever has been downloaded into data/pdfs.
test('real NITE exams', { skip: !pdfs.length || !havePdftotext() ? 'no local exam PDFs' : false }, async (t) => {
  for (const file of pdfs) {
    const [season, year] = path.basename(file, '.pdf').split('_');
    const pdfPath = path.join(PDF_DIR, file);
    const layout = pdfToText(pdfPath, 'layout');

    // A few sittings are published only in a form with no English section
    // at all (autumn 2024). There is nothing here for this suite to check,
    // and the server now refuses to cache one, so a leftover copy in
    // data/pdfs is skipped rather than failed.
    await t.test(`${season} ${year}`, { skip: hasEnglishSection(layout) ? false : 'no English section in this form' }, () => {
      const exam = parseEnglishExam(layout, { season, year: Number(year) }, pdfToText(pdfPath, 'table'));

      // Hebrew-form sittings publish the questions but not an English
      // answer key; the server fills that in from kidum's solution PDFs,
      // which is out of scope here. Everything else about the parse is
      // still worth asserting on those exams.
      const hasEmbeddedKey = layout.includes('Answer Key');

      assert.strictEqual(exam.questionCount, 44);
      for (const label of ['First', 'Second']) {
        assert.deepStrictEqual(
          exam.questions.filter((q) => q.section === label).map((q) => q.number),
          [...Array(22).keys()].map((i) => i + 1)
        );
      }

      const counts = { 'sentence-completion': 0, restatement: 0, 'reading-comprehension': 0 };
      for (const q of exam.questions) {
        counts[q.type] += 1;
        assert.strictEqual(q.options.length, 4, `${q.section}${q.number} options`);
        if (hasEmbeddedKey) {
          assert.ok(Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex <= 3,
            `${q.section}${q.number} answer key`);
        }
        assert.ok(q.prompt.length > 5 && q.prompt.length < 600, `${q.section}${q.number} stem length`);
        for (const opt of q.options) {
          assert.ok(opt.length < 300, `${q.section}${q.number} runaway option: ${opt.slice(0, 80)}`);
        }
        if (q.type === 'sentence-completion') {
          assert.ok(q.prompt.includes('________'), `${q.section}${q.number} missing blank`);
          assert.strictEqual(
            (q.prompt.match(/_{3,}/g) || []).length, 1,
            `${q.section}${q.number} has more than one blank: ${q.prompt}`
          );
        }
        if (q.type === 'reading-comprehension') {
          // Every NITE passage runs to at least two paragraphs, so one
          // means the paragraph split collapsed - the failure mode when
          // an exam indents its paragraph openings differently than the
          // ones the heuristic was tuned against.
          assert.ok(Array.isArray(q.passage) && q.passage.length > 1,
            `${q.section}${q.number} passage did not split into paragraphs`);
          assert.match(
            q.passage[0], /^\[\[1\]\] /,
            `${q.section}${q.number} passage missing its opening line-1 marker`
          );
        }
        for (const s of [q.prompt, ...(q.passage || []), ...q.options]) {
          assert.doesNotMatch(s, /\uFFFD|Copyright by the National Institute|NATIONAL INSTITUTE FOR TESTING/);
          // A real dash is always flanked by whitespace; a dash glued
          // mid-word means cleanText() mistook a lost accented letter for
          // one (see the Le\u00F3n/Mej\u00EDa bug).
          assert.doesNotMatch(s, /[A-Za-z]\u2013[A-Za-z]/, `${q.section}${q.number} dash fabricated inside a word: ${s}`);
        }
      }
      assert.deepStrictEqual(counts, {
        'sentence-completion': 16,
        restatement: 8,
        'reading-comprehension': 20,
      });
    });
  }
});

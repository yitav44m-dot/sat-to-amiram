'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseEnglishExam } = require('../server/parser');

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

function pdfToText(pdfPath) {
  const txtPath = path.join(os.tmpdir(), `${path.basename(pdfPath, '.pdf')}.test.txt`);
  execFileSync('pdftotext', ['-layout', pdfPath, txtPath]);
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
    await t.test(`${season} ${year}`, () => {
      const exam = parseEnglishExam(pdfToText(path.join(PDF_DIR, file)), {
        season,
        year: Number(year),
      });

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
        assert.ok(Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex <= 3,
          `${q.section}${q.number} answer key`);
        assert.ok(q.prompt.length > 5 && q.prompt.length < 600, `${q.section}${q.number} stem length`);
        for (const opt of q.options) {
          assert.ok(opt.length < 300, `${q.section}${q.number} runaway option: ${opt.slice(0, 80)}`);
        }
        for (const s of [q.prompt, q.passage || '', ...q.options]) {
          assert.doesNotMatch(s, /\uFFFD|Copyright by the National Institute|NATIONAL INSTITUTE FOR TESTING/);
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

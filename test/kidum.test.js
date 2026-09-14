'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseSectionTable, parseKidumAnswerKey } = require('../server/kidum');

// A synthetic two-row table, styled after kidum.com's own layout: a
// descending question-number label row, then its answer-digit row below.
function table(labels, digits) {
  return `${labels.join(' ')}\n${digits.join(' ')}\n`;
}

const ENGLISH_GLOSS = '                                              / = attentively :)1(\n';

test('parseSectionTable reads a single 22-question table', () => {
  const first15 = [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const digits15 = [3, 1, 2, 1, 2, 4, 2, 1, 1, 4, 2, 3, 4, 1, 3];
  const last7 = [22, 21, 20, 19, 18, 17, 16];
  const digits7 = [2, 1, 3, 2, 4, 2, 1];
  const page = table(first15, digits15) + table(last7, digits7);

  const result = parseSectionTable(page);
  assert.strictEqual(result.length, 22);
  // Q1..Q15 come from the reversed first group, Q16..Q22 from the reversed second.
  assert.deepStrictEqual(result, [...digits15].reverse().concat([...digits7].reverse()));
});

test('parseSectionTable ignores a page with no recognizable table', () => {
  assert.strictEqual(parseSectionTable('some unrelated Hebrew explanation text'), null);
});

test('parseSectionTable derives answers positionally when the label row is corrupted', () => {
  // Older kidum exports sometimes drop the "0" in "10"/"20", duplicating the
  // neighboring label instead (e.g. "12 11 11 9" where "10" should be). The
  // digit-answer row underneath is unaffected, so the result should be
  // identical to the uncorrupted case.
  const corruptFirst15 = [15, 14, 13, 12, 11, 11, 9, 8, 7, 6, 5, 4, 3, 2, 1]; // "10" -> "11"
  const digits15 = [3, 1, 2, 1, 2, 4, 2, 1, 1, 4, 2, 3, 4, 1, 3];
  const corruptLast7 = [22, 21, 21, 19, 18, 17, 16]; // "20" -> "21"
  const digits7 = [2, 1, 3, 2, 4, 2, 1];
  const page = table(corruptFirst15, digits15) + table(corruptLast7, digits7);

  const result = parseSectionTable(page);
  assert.deepStrictEqual(result, [...digits15].reverse().concat([...digits7].reverse()));
});

test('parseSectionTable rejects a table whose answer digits are out of range', () => {
  const page = table([3, 2, 1], [1, 2, 9]); // 9 is not a valid option 1-4
  assert.strictEqual(parseSectionTable(page), null);
});

test('parseSectionTable reassembles a table whose rows xpdf 4.06 split into fragments', () => {
  // kidum's summer 2020 solutions, page 40, as the Docker image's pdftotext
  // renders it: the 15-question row comes out in two pieces, with page
  // furniture leaking in as dashes on the first label fragment. The older
  // whole-row parser saw no table here at all, and the fallback then paired
  // the wrong two tables - shifting every answer by one section.
  const page =
    '                     -40-    -\n' +
    '15 14  13 12  11 10    -  -\n' +
    '2 3    4 1    1 1\n' +
    '                     9 8 7 6 5 4 3 2 1\n' +
    '                     4 3 3 1 1 3 2 2 2\n' +
    '                            22 21 20 19 18 17 16\n' +
    '                            4 4 4 4 1 4 2\n' +
    '        .      ____       .1\n';
  assert.deepStrictEqual(
    parseSectionTable(page),
    [2, 2, 2, 3, 1, 1, 3, 3, 4, 1, 1, 1, 4, 3, 2, 2, 4, 1, 4, 4, 4, 4]
  );
});

test('parseSectionTable drops a summary page that lists several subjects at once', () => {
  // Question 1 appears once per subject with different answers; that is
  // not one table, and must not be mistaken for an English section.
  const page = table([3, 2, 1], [1, 2, 3]) + table([3, 2, 1], [4, 4, 4]);
  assert.strictEqual(parseSectionTable(page), null);
});

function buildDoc({ withGloss = true } = {}) {
  const en15 = [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const en7 = [22, 21, 20, 19, 18, 17, 16];
  const firstDigits15 = [1, 2, 2, 1, 1, 2, 2, 1, 4, 1, 4, 1, 1, 2, 4];
  const firstDigits7 = [1, 2, 3, 1, 2, 4, 1];
  const secondDigits15 = [1, 1, 4, 3, 1, 4, 4, 4, 4, 1, 4, 2, 1, 3, 4];
  const secondDigits7 = [4, 3, 4, 1, 4, 2, 2];

  const other23 = [23, 22, 21, 20, 19, 18, 17, 16];
  const otherFirst15 = table([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], [
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  ]);
  const otherLast8 = table(other23, [1, 1, 1, 1, 1, 1, 1, 1]);

  const englishFirstPage =
    table(en15, firstDigits15) + table(en7, firstDigits7) + (withGloss ? ENGLISH_GLOSS : '');
  const englishSecondPage =
    table(en15, secondDigits15) + table(en7, secondDigits7) + (withGloss ? ENGLISH_GLOSS : '');

  return {
    doc: [otherFirst15 + otherLast8, englishFirstPage, englishSecondPage].join('\f'),
    expected: {
      First: [...firstDigits15].reverse().concat([...firstDigits7].reverse()),
      Second: [...secondDigits15].reverse().concat([...secondDigits7].reverse()),
    },
  };
}

test('parseKidumAnswerKey picks the English (22-question) tables, not a 23-question subject', () => {
  const { doc, expected } = buildDoc();
  const key = parseKidumAnswerKey(doc);
  assert.deepStrictEqual(key, expected);
});

test('parseKidumAnswerKey requires the English-vocabulary gloss to confirm a 22-question table', () => {
  const { doc } = buildDoc({ withGloss: false });
  assert.strictEqual(parseKidumAnswerKey(doc), null);
});

test('parseKidumAnswerKey returns null when fewer than two matching tables are found', () => {
  assert.strictEqual(parseKidumAnswerKey('no tables here at all'), null);
});

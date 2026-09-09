'use strict';

const NOISE_LINE_RE = /Copyright.*National Institute|The test or any part of it may not be taught|distributed in any form or by any means|^\s*Institute for Testing and Evaluation\.?\s*$|^\s*\d+\s*$/;
const PAGE_FOOTER_RE = /(Verbal Reasoning|Quantitative Reasoning|English).*Section.*(Winter|Spring|Summer|Autumn)\s+\d{4}/;

// pdftotext renders any character its font can't map to Unicode as U+FFFD.
// When it's flanked by whitespace it's almost always an em/en-dash used as
// punctuation (" � " between clauses), so that case is restored. Mid-word
// it's something else entirely - most often an accented Latin letter lost
// from a foreign proper noun (e.g. "Le�n" is "León") - and confidently
// turning that into a dash produces fluent-looking but wrong text. The
// original letter isn't recoverable from the text alone, so it's dropped
// rather than guessed.
function cleanText(text) {
  return text.replace(/(\s)�(\s)/g, '$1–$2').replace(/�/g, '');
}

// pdftotext renders a sentence-completion blank as extra inline whitespace
// (the underline is a drawn line, not text), so a mid-line run of 2+ spaces
// is a blank. Leading indentation from a wrapped continuation line is not
// (nothing precedes it on that line), so it's left alone by default.
//
// detectWrapBlanks is an opt-in used only for table-mode (pdftotext -table)
// cross-referencing, never the primary layout-mode extraction. In table
// mode specifically, a continuation line's leading indent stays at a
// consistent ~4-space baseline for an ordinary wrap - but when the blank
// itself is the first word of the wrapped line, its width pushes that
// baseline out to 7+ spaces, a reliably distinct signal validated against
// real exams. (Layout mode has no such reliable signal - its indent
// reconstruction doesn't track blank width the same way - which is why
// this stays off there.)
const WRAP_BLANK_INDENT_THRESHOLD = 7;

function markBlanks(text, { detectWrapBlanks = false } = {}) {
  return text
    .split('\n')
    .map((line, i) => {
      const marked = line.replace(/(\S) {2,}(?=\S)/g, '$1 ________ ');
      if (!detectWrapBlanks || i === 0 || marked.includes('________')) return marked;
      const trimmed = line.trimStart();
      const leading = line.length - trimmed.length;
      return leading >= WRAP_BLANK_INDENT_THRESHOLD ? `________ ${trimmed}` : marked;
    })
    .join('\n');
}

// Some sentence-completion questions render their blank as literal
// underscore characters in the PDF's own text layer, rather than as a drawn
// line pdftotext turns into whitespace. Normalize any such run to our own
// marker so it reads as "already has a blank" and doesn't also pick up
// ensureBlank()'s fallback on top.
function normalizeNativeBlanks(text) {
  return text.replace(/_{3,}/g, '________');
}

// If no mid-line blank was found, the blank was likely the sentence's last
// word: pdftotext trims trailing whitespace at the end of a line, so a blank
// immediately before the closing period loses its extra spaces down to one,
// instead of the 2+ markBlanks() looks for. When even that's gone (the blank
// left no trace at all), still show one at the end rather than none — a
// sentence-completion question with no visible blank reads as already
// finished.
function ensureBlank(stem) {
  if (stem.includes('________')) return stem;
  const endsWithPeriod = stem.endsWith('.');
  const body = (endsWithPeriod ? stem.slice(0, -1) : stem).trim();
  return `${body} ________${endsWithPeriod ? '.' : ''}`;
}

// If layout-mode extraction lost a blank's position entirely, table-mode
// extraction (pdftotext -table) usually didn't - it preserves the blank's
// underline as a wide run of spaces wherever it falls, at the cost of
// breaking other things (like the answer key) we rely on layout mode for.
// Both extractions contain the exact same words in the same order (only
// whitespace differs), so the blank's word position found in a table-mode
// stem can be spliced straight into the already-cleaned layout-mode stem.
function recoverBlankFromTable(layoutStem, tableStem) {
  if (!tableStem || !tableStem.includes('________')) return null;
  const tableWords = tableStem.split(' ');
  const blankIndex = tableWords.indexOf('________');
  const layoutWords = layoutStem.split(' ');
  if (layoutWords.length !== tableWords.length - 1) return null;
  layoutWords.splice(blankIndex, 0, '________');
  return layoutWords.join(' ');
}

function stripNoise(text) {
  return text
    .split('\n')
    .filter((line) => !NOISE_LINE_RE.test(line) && !PAGE_FOOTER_RE.test(line))
    .join('\n');
}

const ENGLISH_SECTION_MARKER = /ENGLISH\s+This section contains \d+ questions\./;

// NITE publishes some sittings only in a form that leaves the English
// sections out altogether - autumn 2024's booklet runs 48 pages where a
// complete one runs 64, missing exactly the two 8-page English sections,
// and its table of contents skips straight past them. That's a property
// of what NITE published rather than a parse failure, so it gets its own
// type: the server turns it into a real message instead of leaking
// "found 0 markers" to the UI, and the fetcher uses it to avoid keeping
// a PDF it can never parse.
class NoEnglishSectionError extends Error {
  constructor() {
    super('This exam form contains no English section.');
    this.name = 'NoEnglishSectionError';
  }
}

function hasEnglishSection(rawText) {
  return ENGLISH_SECTION_MARKER.test(stripNoise(rawText));
}

function splitEnglishSections(fullText) {
  const matches = [...fullText.matchAll(new RegExp(ENGLISH_SECTION_MARKER, 'g'))];
  if (!matches.length) throw new NoEnglishSectionError();
  if (matches.length < 2) {
    throw new Error(`Expected 2 English section markers, found ${matches.length}`);
  }
  const answerKeyIdx = fullText.indexOf('Answer Key');
  const firstStart = matches[0].index;
  const secondStart = matches[1].index;
  const firstText = fullText.slice(firstStart, secondStart);
  const secondEnd = answerKeyIdx > secondStart ? answerKeyIdx : fullText.length;
  const secondText = fullText.slice(secondStart, secondEnd);
  return { firstText, secondText };
}

function parseOptions(block) {
  const optRe = /\((\d)\)\s*([\s\S]*?)(?=\(\d\)|$)/g;
  const options = [];
  let m;
  while ((m = optRe.exec(block))) {
    const num = Number(m[1]);
    if (num < 1 || num > 4) continue;
    const text = cleanText(m[2].replace(/\s+/g, ' ').trim());
    if (text) options.push(text);
  }
  return options;
}

function parseSimpleQuestions(block, { forceBlank = false, tableBlock = null, detectWrapBlanks = false } = {}) {
  const tableStems = tableBlock ? indexStemsByNumber(tableBlock) : null;
  const questions = [];
  const qRe = /(^|\n)\s*(\d{1,2})\.\s([\s\S]*?)(?=\n\s*\d{1,2}\.\s|$)/g;
  let m;
  while ((m = qRe.exec(block))) {
    const number = Number(m[2]);
    const body = m[3];
    const firstOptIdx = body.search(/\(1\)/);
    if (firstOptIdx === -1) continue;
    let stem = normalizeNativeBlanks(
      cleanText(markBlanks(body.slice(0, firstOptIdx), { detectWrapBlanks }).replace(/\s+/g, ' ').trim())
    );
    if (forceBlank && stem && !stem.includes('________')) {
      const recovered = tableStems && recoverBlankFromTable(stem, tableStems.get(number));
      stem = recovered || ensureBlank(stem);
    }
    const options = parseOptions(body.slice(firstOptIdx));
    if (stem && options.length === 4) {
      questions.push({ number, prompt: stem, options });
    }
  }
  return questions;
}

function indexStemsByNumber(block) {
  const map = new Map();
  for (const q of parseSimpleQuestions(block, { detectWrapBlanks: true })) map.set(q.number, q.prompt);
  return map;
}

// pdftotext -layout puts a genuine new paragraph's opening line at a
// different column from a wrapped continuation line - but not always the
// same different column. Usually the paragraph opens at a single space,
// narrower than the ~7 of a continuation line; in at least one real exam
// (winter 2023, first section, Text I) it opens at 12 instead, wider. So
// the signal is the departure from this passage's own dominant
// continuation indent, in either direction, rather than any absolute
// column. The one-character tolerance absorbs the drift pdftotext
// introduces across a page break within a single paragraph, which is
// never wider than that.
const CONTINUATION_INDENT_DRIFT = 1;

function continuationIndent(lines) {
  const counts = new Map();
  for (const line of lines) {
    if (line.isMarker) continue;
    counts.set(line.leading, (counts.get(line.leading) || 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [leading, count] of counts) {
    if (count > bestCount) {
      best = leading;
      bestCount = count;
    }
  }
  return best;
}

// A line-number marker always sits at column 0, whether it falls mid-
// paragraph or right on a genuine paragraph break, so indentation alone
// can't tell those apart. But the line before a genuine break ends its
// sentence (a period, "?", "!", optionally followed by a closing quote);
// the line before a mid-paragraph marker trails off into the next clause
// with no terminal punctuation. Validated against real exam text where a
// paragraph happened to start exactly on a marker.
const SENTENCE_END_RE = /[.!?]["'”’]?$/;

function splitParagraphs(rawBlock) {
  const lines = rawBlock
    .split('\n')
    .map((line) => {
      const stripped = line.replace(/\r$/, '');
      const trimmed = stripped.trim();
      return { leading: stripped.length - stripped.trimStart().length, trimmed };
    })
    .filter((l) => l.trimmed.length > 0)
    .map((l) => ({ ...l, isMarker: /^\(\d+\)/.test(l.trimmed) }));
  if (!lines.length) return [];

  const baseline = continuationIndent(lines);
  const paragraphs = [];
  let current = [];
  lines.forEach((line, i) => {
    const startsNewParagraph =
      i === 0 ||
      (!line.isMarker && Math.abs(line.leading - baseline) > CONTINUATION_INDENT_DRIFT) ||
      (line.isMarker && SENTENCE_END_RE.test(lines[i - 1].trimmed));
    if (startsNewParagraph && current.length) {
      paragraphs.push(current);
      current = [];
    }
    // NITE prints the original line number (every 5 lines) in the margin,
    // and its own RC questions sometimes refer back to it (e.g. "the word
    // in line 12"). Keep it, in a delimiter the frontend can style as a
    // small marker instead of stripping it - unlike a bare "(N)", this
    // can't collide with an incidental parenthetical number in the prose.
    const markerMatch = line.trimmed.match(/^\((\d+)\)\s?/);
    current.push(
      markerMatch ? `[[${markerMatch[1]}]] ${line.trimmed.slice(markerMatch[0].length)}` : line.trimmed
    );
  });
  if (current.length) paragraphs.push(current);

  return paragraphs
    .map((ls) => cleanText(ls.join(' ').replace(/\s+/g, ' ').trim()))
    .filter(Boolean);
}

function parseReadingComprehension(block) {
  const textRe = /Text (I{1,3}V?)\s*\(Questions (\d+)-(\d+)\)\s*([\s\S]*?)\nQuestions\b[^\n]*\n([\s\S]*?)(?=Text I{1,3}V?\s*\(Questions|$)/g;
  const questions = [];
  let m;
  while ((m = textRe.exec(block))) {
    const passage = splitParagraphs(m[4]);
    const qs = parseSimpleQuestions(m[5]);
    for (const q of qs) {
      questions.push({ ...q, passage });
    }
  }
  return questions;
}

const SC_RE = /Sentence Completions? \(Questions \d+-\d+\)([\s\S]*?)(?=Restatements? \(Questions|Reading Comprehension|$)/;

function extractScBlock(rawSectionText) {
  const appendixIdx = rawSectionText.search(/NAME\s+A\s+I\.D\. No\.|NATIONAL INSTITUTE FOR TESTING & EVALUATION/);
  const sectionText = appendixIdx === -1 ? rawSectionText : rawSectionText.slice(0, appendixIdx);
  const match = sectionText.match(SC_RE);
  return match ? match[1] : null;
}

function parseSection(rawSectionText, label, tableSectionText) {
  const appendixIdx = rawSectionText.search(/NAME\s+A\s+I\.D\. No\.|NATIONAL INSTITUTE FOR TESTING & EVALUATION/);
  const sectionText = appendixIdx === -1 ? rawSectionText : rawSectionText.slice(0, appendixIdx);
  const scMatch = sectionText.match(SC_RE);
  const rsMatch = sectionText.match(/Restatements? \(Questions \d+-\d+\)([\s\S]*?)(?=Reading Comprehension|$)/);
  const rcMatch = sectionText.match(/Reading Comprehension\s*\n[\s\S]*?(?=Text I\s*\(Questions)([\s\S]*)/);
  const tableScBlock = tableSectionText ? extractScBlock(tableSectionText) : null;

  const questions = [];
  if (scMatch) {
    for (const q of parseSimpleQuestions(scMatch[1], { forceBlank: true, tableBlock: tableScBlock })) {
      questions.push({ ...q, type: 'sentence-completion', section: label });
    }
  }
  if (rsMatch) {
    for (const q of parseSimpleQuestions(rsMatch[1])) {
      questions.push({ ...q, type: 'restatement', section: label });
    }
  }
  if (rcMatch) {
    for (const q of parseReadingComprehension(rcMatch[1])) {
      questions.push({ ...q, type: 'reading-comprehension', section: label });
    }
  }
  questions.sort((a, b) => a.number - b.number);
  return questions;
}

function parseAnswerKey(fullText) {
  const keyBlockMatch = fullText.match(/Answer Key[\s\S]*/);
  if (!keyBlockMatch) return {};
  const keyBlock = keyBlockMatch[0];
  const sectionRe = /English\s*.\s*(First|Second) Section\s*\n\s*question number[\s\S]*?correct answer\s+(\d+)/g;
  const result = {};
  let m;
  while ((m = sectionRe.exec(keyBlock))) {
    const label = m[1];
    const digits = m[2].split('').map(Number);
    result[label] = digits;
  }
  return result;
}

function parseEnglishExam(rawText, { season, year }, tableText) {
  const clean = stripNoise(rawText);
  const { firstText, secondText } = splitEnglishSections(clean);

  // tableText (pdftotext -table) is an optional secondary extraction used
  // only to recover sentence-completion blank positions layout mode lost;
  // if it doesn't match our section markers, blank recovery just falls back
  // to ensureBlank() as if it weren't provided at all.
  let tableFirst = null;
  let tableSecond = null;
  if (tableText) {
    try {
      ({ firstText: tableFirst, secondText: tableSecond } = splitEnglishSections(stripNoise(tableText)));
    } catch {
      // ignore - fall back to ensureBlank()
    }
  }

  const firstQuestions = parseSection(firstText, 'First', tableFirst);
  const secondQuestions = parseSection(secondText, 'Second', tableSecond);
  const answerKey = parseAnswerKey(clean);

  const attach = (questions, label) => {
    const key = answerKey[label] || [];
    return questions.map((q) => ({
      ...q,
      correctIndex: key[q.number - 1] ? key[q.number - 1] - 1 : null,
    }));
  };

  const questions = [
    ...attach(firstQuestions, 'First'),
    ...attach(secondQuestions, 'Second'),
  ];

  return {
    season,
    year,
    questionCount: questions.length,
    questions,
  };
}

module.exports = {
  parseEnglishExam,
  stripNoise,
  splitEnglishSections,
  hasEnglishSection,
  NoEnglishSectionError,
};

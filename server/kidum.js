'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const PDF_DIR = path.join(__dirname, '..', 'data', 'kidum');
const SEASON_HE = { winter: 'חורף', spring: 'אביב', summer: 'קיץ', autumn: 'סתיו' };

// kidum.com (a test-prep company) republishes NITE's own sample-exam links
// per season/year, plus their own Hebrew worked-solution PDFs. Their per-year
// index page embeds both as a small JS array, which is a far more reliable
// way to find NITE's real exam URL than guessing upload months/suffixes -
// NITE's own naming is inconsistent (typos, "_acc"/"_heb_acc"/no suffix at
// all across different years) - and it's the only way to reach their
// solutions PDF, which is the answer-key fallback for sittings where NITE
// only published a Hebrew form (no readable answer key of its own).
async function findKidumLinks(season, year) {
  const res = await fetch(`https://kidum.com/psy-solution/${year}-2/`);
  if (!res.ok) return null;
  const html = await res.text();
  const match = html.match(/let filesData = (\[[\s\S]*?\]);/);
  if (!match) return null;

  let entries;
  try {
    entries = JSON.parse(match[1]);
  } catch {
    return null;
  }

  const heWord = SEASON_HE[season];
  const entry = entries.find((e) => e.psy_moed && e.psy_moed.includes(heWord));
  if (!entry || !entry.psy_exam_url || !entry.psy_solution_url) return null;
  return { examUrl: entry.psy_exam_url, solutionUrl: entry.psy_solution_url };
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
}

async function pdfToText(pdfPath) {
  const txtPath = pdfPath.replace(/\.pdf$/, '.txt');
  await execFileAsync('pdftotext', ['-layout', pdfPath, txtPath]);
  const text = fs.readFileSync(txtPath, 'utf8');
  fs.unlinkSync(txtPath);
  return text;
}

// Every subject in kidum's solutions opens with a compact digit table
// (question number -> correct answer, 1-indexed) rendered as row pairs:
// a descending question-number label row, then its answer-digit row below.
// The Hebrew subject label above it is unreadable, and in some older PDF
// exports the number-label row itself is corrupted (pdftotext drops the "0"
// in "10"/"20", producing a duplicated neighbor instead, e.g. "12 11 11 9").
// The answer-digit row is unaffected though, so answers are derived from
// its position (each row descends from the row's first label) rather than
// by trusting the rest of the label row's printed text.
//
// How many rows a table spans depends on the pdftotext build: xpdf 4.06
// can break one row into two fragments ("15 14 13 12 11 10 - -" over
// "2 3 4 1 1 1", then "9 8 7 6 5 4 3 2 1" over "4 3 3 1 1 3 2 2 2"), with
// page furniture leaking in as dashes. So rather than expecting whole
// rows, every label/digit pair is read as a fragment and the table is
// assembled by question number; it counts only if it covers 1..N with no
// gaps and no conflicts (a summary page carrying several subjects' tables
// conflicts on question 1 and is dropped).
function parseSectionTable(pageText) {
  const numbers = (line) =>
    line.split(/\s+/).filter((t) => t !== '-').map((t) => (/^\d{1,2}$/.test(t) ? Number(t) : NaN));
  const isLabelRow = (n) => n.length >= 2 && n.every((x) => x >= 1) && n.every((x, i) => i === 0 || x <= n[i - 1]);
  const isDigitRow = (n) => n.length >= 1 && n.every((x) => x >= 1 && x <= 4);

  const lines = pageText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const key = new Map();
  for (let i = 0; i + 1 < lines.length; i++) {
    const labels = numbers(lines[i]);
    const digits = numbers(lines[i + 1]);
    if (!isLabelRow(labels) || !isDigitRow(digits) || labels.length !== digits.length) continue;
    const top = labels[0];
    if (top < digits.length) continue;
    digits.forEach((d, k) => {
      const question = top - k;
      if (key.has(question) && key.get(question) !== d) key.set(question, NaN);
      else if (!key.has(question)) key.set(question, d);
    });
    i++;
  }
  if (!key.size) return null;

  const table = [];
  for (let q = 1; q <= key.size; q++) {
    if (!key.has(q) || Number.isNaN(key.get(q))) return null;
    table.push(key.get(q));
  }
  return table;
}

// A page belongs to the English section if it (or the pages up to the next
// table) quote English vocabulary in kidum's "= word :)N(" option-gloss
// style - a format unique to English-section explanations.
function hasEnglishGloss(pageText) {
  return /=\s*[A-Za-z]/.test(pageText);
}

function parseKidumAnswerKey(rawText) {
  const pages = rawText.split('\f');
  const tables = [];
  for (let i = 0; i < pages.length; i++) {
    const table = parseSectionTable(pages[i]);
    if (table && table.length === 22) tables.push({ index: i, table });
  }
  if (tables.length < 2) return null;

  // English is 22 questions per part; other subjects use a different count,
  // so any 22-question table is already a strong signal. Confirm with the
  // vocabulary-gloss check across the span up to the next table (or EOF).
  const confirmed = tables.filter(({ index }, i) => {
    const nextIndex = i + 1 < tables.length ? tables[i + 1].index : pages.length;
    const span = pages.slice(index, nextIndex).join('\n');
    return hasEnglishGloss(span);
  });
  if (confirmed.length < 2) return null;

  const [first, second] = confirmed.slice(-2);
  return { First: first.table, Second: second.table };
}

async function getKidumAnswerKey(season, year) {
  const links = await findKidumLinks(season, year);
  if (!links) return null;

  const pdfPath = path.join(PDF_DIR, `kidum_${season}_${year}.pdf`);
  if (!fs.existsSync(pdfPath)) {
    await downloadFile(links.solutionUrl, pdfPath);
  }
  const text = await pdfToText(pdfPath);
  return parseKidumAnswerKey(text);
}

module.exports = { findKidumLinks, parseSectionTable, parseKidumAnswerKey, getKidumAnswerKey };

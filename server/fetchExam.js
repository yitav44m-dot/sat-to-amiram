'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { findKidumLinks } = require('./kidum');
const { hasEnglishSection, NoEnglishSectionError } = require('./parser');

const PDF_DIR = path.join(__dirname, '..', 'data', 'pdfs');
const SEASON_MONTHS = {
  winter: ['01', '02', '12'],
  spring: ['04', '05', '06'],
  summer: ['07', '08', '09'],
  autumn: ['10', '11', '01'],
};

// NITE only publishes an exam for select sittings, and a published one
// can still fail to come down the wire. Either way the sitting can't be
// practiced, which is all the picker can usefully say. Paired with
// NoEnglishSectionError, these are the ways a sitting is legitimately
// unavailable rather than a bug, so both carry a type the server turns
// into Hebrew UI text.
class NoExamPdfError extends Error {
  constructor(season, year) {
    super(`No exam PDF available for ${season} ${year}.`);
    this.name = 'NoExamPdfError';
  }
}

function candidateUrls(season, year) {
  const months = SEASON_MONTHS[season];
  const years = [year, year + 1];
  const suffixes = ['_EN_acc', '_EN'];
  const urls = [];
  for (const uploadYear of years) {
    for (const month of months) {
      for (const suffix of suffixes) {
        urls.push(
          `https://www.nite.org.il/wp-content/uploads/${uploadYear}/${month}/psychometric_${season}_${year}${suffix}.pdf`
        );
      }
    }
  }
  return urls;
}

async function findWorkingUrl(season, year, onProgress) {
  const urls = candidateUrls(season, year);
  for (let i = 0; i < urls.length; i++) {
    onProgress?.(10 + Math.round((i / urls.length) * 30));
    try {
      const res = await fetch(urls[i], { method: 'HEAD' });
      if (res.ok) return urls[i];
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function fetchPdfBytes(url, onProgress) {
  onProgress?.(45);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  onProgress?.(65);
  return buf;
}

// undici collapses every transport-level failure into an opaque
// TypeError: fetch failed, with the real reason (ENOTFOUND,
// UND_ERR_CONNECT_TIMEOUT, a reset mid-body) buried in err.cause. Neither
// that nor an HTTP status is anything a user can act on - from the picker
// it just means this sitting can't be had - so it becomes the one error
// the UI has Hebrew text for, and the detail goes to the server log,
// which is the only place it's any use.
async function downloadPdf(url, destPath, { season, year }, onProgress) {
  let bytes;
  try {
    bytes = await fetchPdfBytes(url, onProgress);
  } catch (err) {
    console.error(`[${season} ${year}] download failed from ${url}:`, err.cause?.code || err.message);
    throw new NoExamPdfError(season, year);
  }
  // Outside the catch on purpose: a disk failure here is a real bug and
  // shouldn't be reported to the user as a missing exam.
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, bytes);
}

async function extractText(pdfPath, mode) {
  const txtPath = pdfPath.replace(/\.pdf$/, `.${mode}.txt`);
  await execFileAsync('pdftotext', [`-${mode}`, pdfPath, txtPath]);
  const text = fs.readFileSync(txtPath, 'utf8');
  fs.unlinkSync(txtPath);
  return text;
}

// Layout mode is the primary extraction (answer key, structure, everything
// else depends on it); table mode is a secondary extraction used only to
// recover sentence-completion blank positions that layout mode loses - see
// recoverBlankFromTable() in server/parser.js.
async function pdfToText(pdfPath, onProgress) {
  onProgress?.(75);
  const layoutText = await extractText(pdfPath, 'layout');
  const tableText = await extractText(pdfPath, 'table').catch(() => null);
  onProgress?.(90);
  return { layoutText, tableText };
}

async function getExamRawText(season, year, onProgress) {
  const pdfPath = path.join(PDF_DIR, `${season}_${year}.pdf`);
  if (!fs.existsSync(pdfPath)) {
    onProgress?.(5);
    let url = await findWorkingUrl(season, year, onProgress);
    if (!url) {
      // No English-labeled edition found by guessing. NITE sometimes only
      // publishes the Hebrew-administered form for a sitting - its English
      // *section* is still in English, just without a machine-readable
      // answer key of its own (see server/kidum.js for that fallback).
      // kidum.com's per-year index resolves NITE's real URL for that form,
      // which is more reliable than guessing since NITE's own naming is
      // inconsistent (typos, varying "_acc"/"_heb_acc"/no-suffix patterns).
      onProgress?.(38);
      const kidumLinks = await findKidumLinks(season, year).catch(() => null);
      url = kidumLinks?.examUrl || null;
    }
    if (!url) throw new NoExamPdfError(season, year);
    await downloadPdf(url, pdfPath, { season, year }, onProgress);
    const texts = await pdfToText(pdfPath, onProgress);
    // Some sittings are only published in a form with no English section
    // at all. Nothing here can ever parse it, and keeping it would mean
    // re-reading a dead 5 MB file on every retry (and, since data/pdfs
    // doubles as the corpus for the real-exam regression tests, feeding
    // them an exam that has no questions to check), so it doesn't stay.
    if (!hasEnglishSection(texts.layoutText)) {
      fs.unlinkSync(pdfPath);
      throw new NoEnglishSectionError();
    }
    return texts;
  }
  onProgress?.(65);
  return pdfToText(pdfPath, onProgress);
}

module.exports = { getExamRawText, candidateUrls, NoExamPdfError };

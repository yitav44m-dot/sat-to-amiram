'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const PDF_DIR = path.join(__dirname, '..', 'data', 'pdfs');
const SEASON_MONTHS = {
  winter: ['01', '02', '12'],
  spring: ['04', '05', '06'],
  summer: ['07', '08', '09'],
  autumn: ['10', '11', '01'],
};

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

async function findWorkingUrl(season, year) {
  for (const url of candidateUrls(season, year)) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) return url;
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function downloadPdf(url, destPath) {
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

async function getExamRawText(season, year) {
  const pdfPath = path.join(PDF_DIR, `${season}_${year}.pdf`);
  if (!fs.existsSync(pdfPath)) {
    const url = await findWorkingUrl(season, year);
    if (!url) {
      throw new Error(
        `No English-language exam PDF found for ${season} ${year}. ` +
          `NITE only publishes English forms for select sittings (roughly once or twice a year).`
      );
    }
    await downloadPdf(url, pdfPath);
  }
  return pdfToText(pdfPath);
}

module.exports = { getExamRawText, candidateUrls };

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { getExamRawText, NoExamPdfError } = require('./fetchExam');
const { parseEnglishExam, NoEnglishSectionError } = require('./parser');
const { getKidumAnswerKey } = require('./kidum');
const { explainQuestion, ExplainerUnavailableError, ExplainerBusyError } = require('./explain');

// On Render the API key is an environment variable; locally it lives in a
// gitignored .env so the same code runs unchanged in both places.
const ENV_FILE = path.join(__dirname, '..', '.env');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const EXAMS_DIR = path.join(__dirname, '..', 'data', 'exams');
const SEASONS = ['winter', 'spring', 'summer', 'autumn'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(req, res) {
  const reqPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(PUBLIC_DIR, path.normalize(reqPath).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// NITE's Hebrew-administered exam form has no machine-readable answer key
// of its own (see server/kidum.js), so when parseEnglishExam finds none at
// all, fall back to kidum.com's own worked-solution PDF for this sitting.
async function applyKidumFallback(exam, season, year) {
  const hasKey = exam.questions.some((q) => q.correctIndex !== null);
  if (hasKey) return exam;

  const kidumKey = await getKidumAnswerKey(season, year).catch(() => null);
  if (!kidumKey) return exam;

  exam.questions = exam.questions.map((q) => {
    const digit = kidumKey[q.section]?.[q.number - 1];
    return digit ? { ...q, correctIndex: digit - 1 } : q;
  });
  return exam;
}

// The picker shows the error verbatim, so the two ways a sitting can
// legitimately be unavailable get real Hebrew text rather than a parser
// internal. Anything else is a bug and keeps its own message, which is
// far more useful in the browser than a generic apology.
function userMessage(err) {
  if (err instanceof NoEnglishSectionError) {
    return 'הטופס שפרסם מאל"ו למועד זה אינו כולל פרק אנגלית. בחר מועד אחר.';
  }
  if (err instanceof NoExamPdfError) {
    return 'לא נמצאה בחינה למועד זה. מאל"ו מפרסם בחינות לחלק מהמועדים בלבד.';
  }
  return err.message;
}

async function handleExamRequest(query, res) {
  const season = (query.get('season') || '').toLowerCase();
  const year = Number(query.get('year'));

  if (!SEASONS.includes(season) || !Number.isInteger(year) || year < 2015 || year > 2100) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Provide a valid season (winter/spring/summer/autumn) and year.' }));
    return;
  }

  // Streamed as newline-delimited JSON so the client can show real fetch/
  // parse progress instead of a fake animation. The HTTP status is always
  // 200 once streaming starts (it can't change mid-stream); success/failure
  // is carried by the "done"/"error" line instead.
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
  const sendProgress = (progress) => res.write(JSON.stringify({ progress }) + '\n');

  try {
    const exam = await loadExam(season, year, sendProgress);
    res.end(JSON.stringify({ progress: 100, exam }) + '\n');
  } catch (err) {
    res.end(JSON.stringify({ error: userMessage(err) }) + '\n');
  }
}

async function loadExam(season, year, sendProgress = () => {}) {
  const cachePath = path.join(EXAMS_DIR, `${season}_${year}.json`);
  if (fs.existsSync(cachePath)) return JSON.parse(fs.readFileSync(cachePath, 'utf8'));

  sendProgress(2);
  const { layoutText, tableText } = await getExamRawText(season, year, sendProgress);
  sendProgress(92);
  let exam = parseEnglishExam(layoutText, { season, year }, tableText);
  exam = await applyKidumFallback(exam, season, year);
  sendProgress(97);

  fs.mkdirSync(EXAMS_DIR, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(exam));
  return exam;
}

// The exam is loaded the same way /api/exam loads it, not read from the
// cache alone: on Render the disk is wiped by every deploy and idle spin-
// down, so an exam taken before one of those is gone by the time its
// results page asks for an explanation.
async function handleExplainRequest(query, res) {
  const season = (query.get('season') || '').toLowerCase();
  const year = Number(query.get('year'));
  const section = query.get('section');
  const number = Number(query.get('number'));

  const reply = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  };

  if (!SEASONS.includes(season) || !Number.isInteger(year)) {
    reply(400, { error: 'Unknown exam.' });
    return;
  }

  try {
    const exam = await loadExam(season, year);
    const question = exam.questions.find((q) => q.section === section && q.number === number);
    if (!question || question.correctIndex === null) {
      reply(404, { error: 'Unknown question.' });
      return;
    }
    reply(200, { explanation: await explainQuestion(question, { season, year }) });
  } catch (err) {
    if (err instanceof ExplainerUnavailableError || err instanceof ExplainerBusyError) {
      reply(503, { error: err.message });
      return;
    }
    console.error(`[explain ${season} ${year} ${section}${number}]`, err.message);
    reply(500, { error: 'ההסבר אינו זמין כרגע.' });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/exam') {
    handleExamRequest(url.searchParams, res);
    return;
  }
  if (url.pathname === '/api/explain') {
    handleExplainRequest(url.searchParams, res);
    return;
  }

  req.url = url.pathname;
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`SAT to Amiram running at http://localhost:${PORT}`);
});

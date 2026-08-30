'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { getExamRawText } = require('./fetchExam');
const { parseEnglishExam } = require('./parser');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const EXAMS_DIR = path.join(__dirname, '..', 'data', 'exams');

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

async function handleExamRequest(query, res) {
  const season = (query.get('season') || '').toLowerCase();
  const year = Number(query.get('year'));
  const validSeasons = ['winter', 'spring', 'summer', 'autumn'];

  if (!validSeasons.includes(season) || !Number.isInteger(year) || year < 2015 || year > 2100) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Provide a valid season (winter/spring/summer/autumn) and year.' }));
    return;
  }

  const cachePath = path.join(EXAMS_DIR, `${season}_${year}.json`);
  try {
    if (fs.existsSync(cachePath)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(fs.readFileSync(cachePath, 'utf8'));
      return;
    }

    const rawText = await getExamRawText(season, year);
    const exam = parseEnglishExam(rawText, { season, year });

    fs.mkdirSync(EXAMS_DIR, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(exam));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(exam));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/exam') {
    handleExamRequest(url.searchParams, res);
    return;
  }

  req.url = url.pathname;
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`SAT to Amiram running at http://localhost:${PORT}`);
});

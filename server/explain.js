'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'explanations');
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// The two ways an explanation can legitimately be unavailable, as opposed
// to a bug: the server has no key at all (a local checkout without one, or
// a deployment where it was never set), and the free tier's per-minute
// quota being hit. Both get Hebrew text the review page can show as-is.
class ExplainerUnavailableError extends Error {
  constructor() {
    super('ההסבר אינו זמין כרגע.');
    this.name = 'ExplainerUnavailableError';
  }
}

class ExplainerBusyError extends Error {
  constructor() {
    super('השירות עמוס כרגע. נסה שוב בעוד רגע.');
    this.name = 'ExplainerBusyError';
  }
}

function buildPrompt(question) {
  const options = question.options.map((o, i) => `(${i + 1}) ${o}`).join('\n');
  const passage = question.passage
    ? `הקטע:\n${question.passage.map((p) => p.replace(/\[\[\d+\]\] /g, '')).join('\n\n')}\n\n`
    : '';
  return (
    'אתה מורה לאנגלית שמכין תלמידים למבחן אמיר"ם. תלמיד ענה לא נכון על השאלה הבאה מתוך פרק אנגלית ' +
    'בבחינה הפסיכומטרית. כתוב הסבר קצר בעברית: תחילה למה התשובה הנכונה מתאימה (2-3 משפטים, ' +
    'ובשאלת השלמת משפטים ציין את פירוש המילה), ואחר כך משפט אחד לכל אחת משלוש התשובות האחרות ' +
    'למה היא אינה מתאימה, בפורמט "(מספר) מילה/ביטוי - הסבר". כתוב טקסט רגיל בלבד, ללא כותרות, ' +
    'ללא Markdown וללא הקדמה.\n\n' +
    passage +
    `השאלה:\n${question.prompt}\n\n${options}\n\nהתשובה הנכונה: (${question.correctIndex + 1})`
  );
}

async function askGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ExplainerUnavailableError();
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const res = await fetch(`${GEMINI_URL}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (res.status === 429 || res.status === 503) throw new ExplainerBusyError();
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('').trim();
  if (!text) throw new Error('Gemini returned no text');
  return text;
}

function cachePath(season, year) {
  return path.join(CACHE_DIR, `${season}_${year}.json`);
}

function readCache(season, year) {
  const file = cachePath(season, year);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

// Two visitors pressing the button on the same uncached question within
// a few seconds would otherwise cost two API calls for one answer.
const inFlight = new Map();

async function explainQuestion(question, { season, year }) {
  const id = `${question.section}-${question.number}`;
  const cached = readCache(season, year)[id];
  if (cached) return cached;

  const flightKey = `${season}_${year}_${id}`;
  if (inFlight.has(flightKey)) return inFlight.get(flightKey);

  const pending = askGemini(buildPrompt(question)).then((text) => {
    const cache = readCache(season, year);
    cache[id] = text;
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath(season, year), JSON.stringify(cache, null, 2));
    return text;
  }).finally(() => inFlight.delete(flightKey));
  inFlight.set(flightKey, pending);
  return pending;
}

module.exports = { explainQuestion, buildPrompt, ExplainerUnavailableError, ExplainerBusyError };

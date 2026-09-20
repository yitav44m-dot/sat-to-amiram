'use strict';

const SEASONS_HE = { winter: 'חורף', spring: 'אביב', summer: 'קיץ', autumn: 'סתיו' };

const ICONS = {
  book:
    '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  brain:
    '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>',
  cap:
    '<path d="M21.42 10.92a1 1 0 0 0-.02-1.84L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.83l8.57 3.91a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  timer: '<path d="M10 2h4"/><path d="M12 14 15 11"/><circle cx="12" cy="14" r="8"/>',
  speaker:
    '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6a1.4 1.4 0 0 1-1 .4H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.4 5.6a9 9 0 0 1 0 12.7"/>',
};

function svg(name) {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>'
  );
}

// The parser embeds NITE's own original line numbers (printed every 5 lines
// in the source, and sometimes referenced by RC questions, e.g. "the word
// in line 12") as "[[N]] " markers inline in the passage text. Render them
// as small badges instead of raw brackets.
const LINE_MARKER_RE = /\[\[(\d+)\]\]\s?/g;

function appendPassageText(container, text) {
  LINE_MARKER_RE.lastIndex = 0;
  let lastIndex = 0;
  let match;
  while ((match = LINE_MARKER_RE.exec(text))) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const marker = document.createElement('span');
    marker.className = 'line-marker';
    marker.textContent = match[1];
    container.appendChild(marker);
    lastIndex = LINE_MARKER_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    container.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

function stripLineMarkers(text) {
  return text.replace(LINE_MARKER_RE, '');
}

const state = {
  exam: null,
  parts: [],
  partIndex: 0,
  questionIndex: 0,
  answers: [],
  remaining: 0,
  ticker: null,
};

const el = {};
[
  'picker', 'season', 'year', 'load-btn', 'status', 'loading-bar', 'loading-bar-fill',
  'control', 'part-now', 'part-total', 'part-tabs', 'part-title', 'part-sub',
  'timer-icon', 'timer-value', 'q-now', 'q-total', 'q-pills',
  'prev-btn', 'next-btn', 'finish-part-btn',
  'question-card', 'q-instruction', 'passage-box', 'passage-text', 'passage-speak',
  'q-stem-text', 'stem-speak', 'q-options',
  'results', 'score-value', 'score-detail', 'stat-minutes', 'stat-questions', 'stat-correct',
  'review', 'restart-btn',
].forEach((id) => {
  el[id] = document.getElementById(id);
});

// The earliest sitting NITE has published; the list runs newest first,
// so the current year is the default, and it grows by itself each year.
const FIRST_EXAM_YEAR = 2019;
for (let y = new Date().getFullYear(); y >= FIRST_EXAM_YEAR; y--) {
  el.year.append(new Option(y, y));
}

// The picker opens on whichever sitting was practiced last on this device.
const LAST_EXAM_KEY = 'lastExam';
try {
  const last = JSON.parse(localStorage.getItem(LAST_EXAM_KEY));
  if (last && SEASONS_HE[last.season] && last.year) {
    el.season.value = last.season;
    el.year.value = last.year;
  }
} catch {
  // storage unavailable - keep the page's own default
}

el['load-btn'].addEventListener('click', loadExam);
el['prev-btn'].addEventListener('click', () => goToQuestion(state.questionIndex - 1));
el['next-btn'].addEventListener('click', () => goToQuestion(state.questionIndex + 1));
el['finish-part-btn'].addEventListener('click', finishPart);
el['restart-btn'].addEventListener('click', () => location.reload());
el['stem-speak'].addEventListener('click', () => speak(el['q-stem-text'].textContent));
el['passage-speak'].addEventListener('click', () => {
  const part = state.parts[state.partIndex];
  speak((part.passage || []).map(stripLineMarkers).join('\n\n'));
});

el['timer-icon'].innerHTML = svg('timer');
el['stem-speak'].innerHTML = svg('speaker');
el['passage-speak'].innerHTML = svg('speaker');

function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

function setLoadingProgress(percent) {
  el['loading-bar-fill'].style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

// The server streams newline-delimited JSON progress lines ({"progress": N})
// while it locates the NITE PDF, downloads it, and runs pdftotext, ending in
// either {"progress":100,"exam":{...}} or {"error":"..."}. This drives the
// loading bar off real backend state instead of a fake animation.
async function readExamStream(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let exam = null;
  let errorMessage = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;

      const msg = JSON.parse(line);
      if (typeof msg.progress === 'number') setLoadingProgress(msg.progress);
      if (msg.exam) exam = msg.exam;
      if (msg.error) errorMessage = msg.error;
    }
  }

  if (errorMessage) throw new Error(errorMessage);
  return exam;
}

async function loadExam() {
  const season = el.season.value;
  const year = el.year.value;
  el.status.textContent = '';
  el.status.className = 'status';
  el['load-btn'].disabled = true;
  setLoadingProgress(0);
  el['loading-bar'].hidden = false;

  try {
    const res = await fetch(`/api/exam?season=${season}&year=${year}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'טעינת הבחינה נכשלה');
    }

    const data = await readExamStream(res);
    if (!data || !data.questions || !data.questions.length) {
      throw new Error('לא נמצאו שאלות בבחינה זו.');
    }

    state.exam = data;
    try {
      localStorage.setItem(LAST_EXAM_KEY, JSON.stringify({ season, year }));
    } catch {
      // storage unavailable - nothing to remember with
    }
    state.parts = buildParts(data.questions);
    state.partIndex = 0;
    state.answers = new Array(data.questions.length).fill(null);
    state.lockedParts = new Array(state.parts.length).fill(false);
    state.startedAt = Date.now();

    el.picker.hidden = true;
    el.control.hidden = false;
    el['question-card'].hidden = false;
    el['part-total'].textContent = state.parts.length;
    el['part-sub'].textContent = `סימולציית אמירם | ${SEASONS_HE[season]} ${year}`;

    renderTabs();
    openPart(0);
  } catch (err) {
    el.status.textContent = err.message;
    el.status.className = 'status error';
  } finally {
    el['load-btn'].disabled = false;
    el['loading-bar'].hidden = true;
  }
}

function renderTabs() {
  el['part-tabs'].innerHTML = '';
  state.parts.forEach((part, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'part-tab';
    btn.innerHTML = svg(part.icon);
    const label = document.createElement('span');
    label.textContent = `פרק ${i + 1}`;
    btn.appendChild(label);
    btn.addEventListener('click', () => openPart(i));
    li.appendChild(btn);
    el['part-tabs'].appendChild(li);
  });
}

function openPart(index) {
  if (index < 0 || index >= state.parts.length) return;
  // Once a part is left — by timeout, the finish button, or a tab click —
  // it locks: there is no going back to it, matching a real timed exam.
  if (state.lockedParts[index] && index !== state.partIndex) return;
  if (index !== state.partIndex) state.lockedParts[state.partIndex] = true;

  state.partIndex = index;
  state.questionIndex = 0;

  const part = state.parts[index];
  el['part-now'].textContent = index + 1;
  el['part-title'].textContent = `${part.titleHe} ${part.ordinal}`;
  el['q-instruction'].textContent = part.heading;
  el['q-total'].textContent = part.indices.length;

  [...el['part-tabs'].querySelectorAll('.part-tab')].forEach((tab, i) => {
    tab.classList.toggle('active', i === index);
    tab.classList.toggle('done', state.lockedParts[i]);
    tab.disabled = state.lockedParts[i];
  });

  if (part.passage) {
    el['passage-box'].hidden = false;
    el['passage-text'].innerHTML = '';
    part.passage.forEach((paragraph) => {
      const p = document.createElement('p');
      appendPassageText(p, paragraph);
      el['passage-text'].appendChild(p);
    });
  } else {
    el['passage-box'].hidden = true;
    el['passage-text'].innerHTML = '';
  }

  el['finish-part-btn'].textContent =
    index === state.parts.length - 1 ? 'סיים סימולציה' : 'סיים פרק ועבור להבא';

  startTimer(part.seconds);
  renderPills();
  renderQuestion();
}

function startTimer(seconds) {
  clearInterval(state.ticker);
  state.remaining = seconds;
  paintTimer();
  state.ticker = setInterval(() => {
    state.remaining -= 1;
    paintTimer();
    if (state.remaining <= 0) {
      clearInterval(state.ticker);
      finishPart();
    }
  }, 1000);
}

function paintTimer() {
  const total = Math.max(state.remaining, 0);
  const minutes = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, '0');
  el['timer-value'].textContent = `${minutes}:${secs}`;
  el['timer-value'].parentElement.parentElement.classList.toggle('low', total <= 30);
}

function renderPills() {
  const part = state.parts[state.partIndex];
  el['q-pills'].innerHTML = '';
  part.indices.forEach((questionIndex, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'q-pill';
    btn.textContent = i + 1;
    if (i === state.questionIndex) btn.classList.add('current');
    else if (state.answers[questionIndex] !== null) btn.classList.add('answered');
    btn.addEventListener('click', () => goToQuestion(i));
    li.appendChild(btn);
    el['q-pills'].appendChild(li);
  });
}

function renderQuestion() {
  const part = state.parts[state.partIndex];
  const questionIndex = part.indices[state.questionIndex];
  const question = state.exam.questions[questionIndex];

  el['q-now'].textContent = state.questionIndex + 1;
  el['q-stem-text'].textContent = question.prompt;

  el['q-options'].innerHTML = '';
  question.options.forEach((optionText, i) => {
    const li = document.createElement('li');
    li.className = 'q-option-row';

    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'q-option';
    option.dir = 'ltr';
    option.lang = 'en';
    option.textContent = optionText;
    if (state.answers[questionIndex] === i) option.classList.add('selected');
    option.addEventListener('click', () => {
      state.answers[questionIndex] = i;
      [...el['q-options'].querySelectorAll('.q-option')].forEach((node, ni) => {
        node.classList.toggle('selected', ni === i);
      });
      renderPills();
    });

    const speaker = document.createElement('button');
    speaker.type = 'button';
    speaker.className = 'speak';
    speaker.setAttribute('aria-label', 'הקראת התשובה');
    speaker.innerHTML = svg('speaker');
    speaker.addEventListener('click', () => speak(optionText));

    li.append(option, speaker);
    el['q-options'].appendChild(li);
  });

  el['prev-btn'].disabled = state.questionIndex === 0;
  el['next-btn'].disabled = state.questionIndex === part.indices.length - 1;
}

function goToQuestion(index) {
  const part = state.parts[state.partIndex];
  if (index < 0 || index >= part.indices.length) return;
  state.questionIndex = index;
  renderPills();
  renderQuestion();
}

function finishPart() {
  state.lockedParts[state.partIndex] = true;
  if (state.partIndex === state.parts.length - 1) {
    showResults();
    return;
  }
  openPart(state.partIndex + 1);
}

// A wrong answer gets a button that fetches a short Hebrew explanation of
// why the key is right and each other option is not. Loaded on demand so
// only the questions someone actually wonders about cost an API call.
function explainControl(question) {
  const wrap = document.createElement('div');
  wrap.className = 'review-explain';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-gray btn-small';
  button.textContent = 'הסבר';
  wrap.appendChild(button);

  const text = document.createElement('p');
  text.className = 'review-explain-text';
  text.hidden = true;
  wrap.appendChild(text);

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'טוען...';
    const { season, year } = state.exam;
    const params = new URLSearchParams({ season, year, section: question.section, number: question.number });
    try {
      const res = await fetch(`/api/explain?${params}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'ההסבר אינו זמין כרגע.');
      text.textContent = body.explanation;
      text.hidden = false;
      button.hidden = true;
    } catch (err) {
      text.textContent = err.message;
      text.classList.add('error');
      text.hidden = false;
      button.disabled = false;
      button.textContent = 'נסה שוב';
    }
  });

  return wrap;
}

function showResults() {
  clearInterval(state.ticker);
  window.speechSynthesis?.cancel();

  const questions = state.exam.questions;
  let correctCount = 0;
  let gradableCount = 0;

  el.control.hidden = true;
  el['question-card'].hidden = true;
  el.results.hidden = false;
  el.review.innerHTML = '';

  state.parts.forEach((part, partIndex) => {
    const block = document.createElement('section');
    block.className = 'review-part';

    // A question with no answer key (see applyKidumFallback on the server)
    // can't be graded either way, so it is neither counted as wrong nor
    // included in the total the score is taken over.
    const gradable = part.indices.filter((i) => questions[i].correctIndex !== null);
    const partCorrect = gradable.filter((i) => state.answers[i] === questions[i].correctIndex).length;
    correctCount += partCorrect;
    gradableCount += gradable.length;

    const heading = document.createElement('h3');
    heading.textContent =
      `פרק ${partIndex + 1} — ${part.titleHe} ${part.ordinal} (${partCorrect}/${gradable.length})`;
    block.appendChild(heading);

    part.indices.forEach((questionIndex, i) => {
      const question = questions[questionIndex];
      const userAnswer = state.answers[questionIndex];
      const isCorrect = userAnswer === question.correctIndex;

      const item = document.createElement('div');
      item.className = 'review-item';

      const tag = document.createElement('span');
      if (question.correctIndex === null) {
        tag.className = 'tag blank';
        tag.textContent = 'אין מפתח תשובות';
      } else if (userAnswer === null) {
        tag.className = 'tag blank';
        tag.textContent = 'לא נענה';
      } else {
        tag.className = `tag ${isCorrect ? 'correct' : 'wrong'}`;
        tag.textContent = isCorrect ? 'נכון' : 'שגוי';
      }
      item.appendChild(tag);

      const prompt = document.createElement('p');
      prompt.className = 'review-prompt';
      prompt.textContent = `${i + 1}. ${question.prompt}`;
      item.appendChild(prompt);

      question.options.forEach((optionText, oi) => {
        const line = document.createElement('div');
        line.className = 'review-option';
        let label = optionText;
        if (oi === question.correctIndex) {
          line.classList.add('is-correct');
          label += '  ✓ התשובה הנכונה';
        }
        if (oi === userAnswer && !isCorrect) {
          line.classList.add('is-yours');
          label += '  ✗ תשובתך';
        }
        line.textContent = label;
        item.appendChild(line);
      });

      if (userAnswer !== null && question.correctIndex !== null && !isCorrect) item.appendChild(explainControl(question));

      block.appendChild(item);
    });

    el.review.appendChild(block);
  });

  const totalMandatory = gradableCount;
  const score = amirnetScore(correctCount, totalMandatory);
  const minutes = Math.max(0, Math.round((Date.now() - state.startedAt) / 60000));

  el['score-value'].textContent = score;
  el['score-detail'].textContent = `${correctCount} תשובות נכונות מתוך ${totalMandatory}`;
  el['stat-minutes'].textContent = minutes;
  el['stat-questions'].textContent = totalMandatory;
  el['stat-correct'].textContent = correctCount;
}

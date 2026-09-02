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
  'picker', 'season', 'year', 'load-btn', 'status',
  'control', 'part-now', 'part-total', 'part-tabs', 'part-title', 'part-sub',
  'timer-icon', 'timer-value', 'q-now', 'q-total', 'q-pills',
  'prev-btn', 'next-btn', 'finish-part-btn',
  'question-card', 'q-instruction', 'passage-box', 'passage-text', 'passage-speak',
  'q-stem-text', 'stem-speak', 'q-options',
  'results', 'score-summary', 'review', 'restart-btn',
].forEach((id) => {
  el[id] = document.getElementById(id);
});

el['load-btn'].addEventListener('click', loadExam);
el['prev-btn'].addEventListener('click', () => goToQuestion(state.questionIndex - 1));
el['next-btn'].addEventListener('click', () => goToQuestion(state.questionIndex + 1));
el['finish-part-btn'].addEventListener('click', finishPart);
el['restart-btn'].addEventListener('click', () => location.reload());
el['stem-speak'].addEventListener('click', () => speak(el['q-stem-text'].textContent));
el['passage-speak'].addEventListener('click', () => speak(el['passage-text'].textContent));

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

async function loadExam() {
  const season = el.season.value;
  const year = el.year.value;
  el.status.textContent = 'טוען ומנתח את הבחינה…';
  el.status.className = 'status';
  el['load-btn'].disabled = true;

  try {
    const res = await fetch(`/api/exam?season=${season}&year=${year}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'טעינת הבחינה נכשלה');
    if (!data.questions || !data.questions.length) throw new Error('לא נמצאו שאלות בבחינה זו.');

    state.exam = data;
    state.parts = buildParts(data.questions);
    state.partIndex = 0;
    state.answers = new Array(data.questions.length).fill(null);
    state.lockedParts = new Array(state.parts.length).fill(false);

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
    el['passage-text'].textContent = part.passage;
  } else {
    el['passage-box'].hidden = true;
    el['passage-text'].textContent = '';
  }

  el['finish-part-btn'].textContent =
    index === state.parts.length - 1 ? 'סיים סימולציה' : 'סיים פרק ועבור לבא';

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

function showResults() {
  clearInterval(state.ticker);
  window.speechSynthesis?.cancel();

  const questions = state.exam.questions;
  let correctCount = 0;

  el.control.hidden = true;
  el['question-card'].hidden = true;
  el.results.hidden = false;
  el.review.innerHTML = '';

  state.parts.forEach((part, partIndex) => {
    const block = document.createElement('section');
    block.className = 'review-part';

    const partCorrect = part.indices.filter((i) => state.answers[i] === questions[i].correctIndex).length;
    correctCount += partCorrect;

    const heading = document.createElement('h3');
    heading.textContent =
      `פרק ${partIndex + 1} — ${part.titleHe} ${part.ordinal} (${partCorrect}/${part.indices.length})`;
    block.appendChild(heading);

    part.indices.forEach((questionIndex, i) => {
      const question = questions[questionIndex];
      const userAnswer = state.answers[questionIndex];
      const isCorrect = userAnswer === question.correctIndex;

      const item = document.createElement('div');
      item.className = 'review-item';

      const tag = document.createElement('span');
      if (userAnswer === null) {
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

      block.appendChild(item);
    });

    el.review.appendChild(block);
  });

  el['score-summary'].innerHTML =
    `ציון: <b>${correctCount}</b> מתוך ${questions.length} שאלות, ב-${state.parts.length} פרקים`;
}

'use strict';

const state = {
  exam: null,
  index: 0,
  answers: [],
};

const el = {
  loadBtn: document.getElementById('load-btn'),
  season: document.getElementById('season'),
  year: document.getElementById('year'),
  status: document.getElementById('status'),
  picker: document.getElementById('picker'),
  quiz: document.getElementById('quiz'),
  results: document.getElementById('results'),
  progress: document.getElementById('progress'),
  examLabel: document.getElementById('exam-label'),
  passage: document.getElementById('passage'),
  question: document.getElementById('question'),
  options: document.getElementById('options'),
  prevBtn: document.getElementById('prev-btn'),
  nextBtn: document.getElementById('next-btn'),
  finishBtn: document.getElementById('finish-btn'),
  scoreSummary: document.getElementById('score-summary'),
  review: document.getElementById('review'),
  restartBtn: document.getElementById('restart-btn'),
};

el.loadBtn.addEventListener('click', loadExam);
el.prevBtn.addEventListener('click', () => go(-1));
el.nextBtn.addEventListener('click', () => go(1));
el.finishBtn.addEventListener('click', showResults);
el.restartBtn.addEventListener('click', () => location.reload());

async function loadExam() {
  const season = el.season.value;
  const year = el.year.value;
  el.status.textContent = 'Fetching and parsing exam…';
  el.status.className = 'status';
  el.loadBtn.disabled = true;

  try {
    const res = await fetch(`/api/exam?season=${season}&year=${year}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load exam');
    if (!data.questions || !data.questions.length) throw new Error('No questions parsed from this exam.');

    state.exam = data;
    state.index = 0;
    state.answers = new Array(data.questions.length).fill(null);

    el.picker.hidden = true;
    el.quiz.hidden = false;
    el.examLabel.textContent = `${capitalize(season)} ${year} — English`;
    renderQuestion();
  } catch (err) {
    el.status.textContent = err.message;
    el.status.className = 'status error';
  } finally {
    el.loadBtn.disabled = false;
  }
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function renderQuestion() {
  const q = state.exam.questions[state.index];
  el.progress.textContent = `Question ${state.index + 1} of ${state.exam.questions.length}`;

  if (q.passage) {
    el.passage.hidden = false;
    el.passage.textContent = q.passage;
  } else {
    el.passage.hidden = true;
    el.passage.textContent = '';
  }

  el.question.textContent = q.prompt;
  el.options.innerHTML = '';

  q.options.forEach((optText, i) => {
    const btn = document.createElement('button');
    btn.className = 'option';
    btn.textContent = `${i + 1}. ${optText}`;
    if (state.answers[state.index] === i) btn.classList.add('selected');
    btn.addEventListener('click', () => selectAnswer(i));
    el.options.appendChild(btn);
  });

  el.prevBtn.disabled = state.index === 0;
  const isLast = state.index === state.exam.questions.length - 1;
  el.nextBtn.hidden = isLast;
  el.finishBtn.hidden = !isLast;
}

function selectAnswer(i) {
  state.answers[state.index] = i;
  renderQuestion();
}

function go(delta) {
  const next = state.index + delta;
  if (next < 0 || next >= state.exam.questions.length) return;
  state.index = next;
  renderQuestion();
}

function showResults() {
  const questions = state.exam.questions;
  let correctCount = 0;

  el.quiz.hidden = true;
  el.results.hidden = false;
  el.review.innerHTML = '';

  questions.forEach((q, i) => {
    const userAnswer = state.answers[i];
    const isCorrect = userAnswer === q.correctIndex;
    if (isCorrect) correctCount++;

    const item = document.createElement('div');
    item.className = 'review-item';

    const tag = document.createElement('span');
    tag.className = `tag ${isCorrect ? 'correct' : 'wrong'}`;
    tag.textContent = isCorrect ? 'Correct' : 'Incorrect';
    item.appendChild(tag);

    const prompt = document.createElement('p');
    prompt.textContent = `${i + 1}. ${q.prompt}`;
    item.appendChild(prompt);

    q.options.forEach((optText, oi) => {
      const line = document.createElement('div');
      let label = `${oi + 1}. ${optText}`;
      if (oi === q.correctIndex) label += '  ✓ correct answer';
      if (oi === userAnswer && oi !== q.correctIndex) label += '  ✗ your answer';
      line.textContent = label;
      item.appendChild(line);
    });

    el.review.appendChild(item);
  });

  el.scoreSummary.textContent = `You scored ${correctCount} / ${questions.length}`;
}

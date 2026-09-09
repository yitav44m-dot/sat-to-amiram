'use strict';

// The Amiram exam is delivered as a sequence of short, self-contained parts.
// Each part holds one question type, opens with its own instructions, and is
// answered one question at a time under its own countdown. Order, part sizes
// and the Hebrew chrome follow the official-style simulation at
// ptor.co.il/innersimulation_amirnet.asp?simID=1.
const PART_TYPES = {
  'sentence-completion': {
    title: 'Sentence Completions',
    titleHe: 'השלמת משפטים',
    heading: 'השלם את המילה החסרה במשפט:',
    icon: 'book',
    instructions:
      'This part consists of sentences with a word or words missing in each. ' +
      'For each question, choose the answer which best completes the sentence.',
  },
  restatement: {
    title: 'Restatements',
    titleHe: 'ניסוח מחדש',
    heading: 'בחר את המשפט המנסח מחדש את המשפט הבא:',
    icon: 'brain',
    instructions:
      'This part consists of several sentences, each followed by four possible ways of restating ' +
      'the main idea of that sentence in different words. For each question, choose the one ' +
      'restatement which best expresses the meaning of the original sentence.',
  },
  'reading-comprehension': {
    title: 'Reading Comprehension',
    titleHe: 'הבנת הנקרא',
    heading: 'קרא את הקטע וענה על השאלה:',
    icon: 'cap',
    instructions:
      'This part consists of a passage followed by several related questions. ' +
      'For each question, choose the most appropriate answer based on the text.',
  },
};

// The real Amiram simulation is exactly these six chapters, in this order,
// each with its own fixed time budget regardless of how many questions land
// in it.
const PART_TEMPLATE = [
  { type: 'sentence-completion', size: 4 },
  { type: 'sentence-completion', size: 4 },
  { type: 'reading-comprehension' },
  { type: 'restatement', size: 3 },
  { type: 'restatement', size: 3 },
  { type: 'sentence-completion', size: 4 },
];

const PART_SECONDS = {
  'sentence-completion': 4 * 60,
  restatement: 6 * 60,
  'reading-comprehension': 15 * 60,
};

function samePassage(a, b) {
  return a.length === b.length && a.every((paragraph, i) => paragraph === b[i]);
}

function groupPassages(questions) {
  const texts = [];
  questions.forEach((q, index) => {
    if (q.type !== 'reading-comprehension') return;
    const current = texts[texts.length - 1];
    // Content comparison, not reference equality: a cached exam is reloaded
    // from JSON, which always creates fresh array instances even for
    // questions that shared the exact same passage before being cached.
    if (current && samePassage(current.passage, q.passage)) current.indices.push(index);
    else texts.push({ section: q.section, passage: q.passage, indices: [index] });
  });
  return texts;
}

// A NITE exam carries four texts - two per section - and the simulation has
// room for one. The pool is each section's *second* text, picked at random so
// repeated runs of the same exam don't always drill the same passage. A pool
// with no second text anywhere (a partial exam) falls back to what's there.
function takeReadingText(texts) {
  const perSection = new Map();
  const secondOfSection = texts.filter((text) => {
    const nth = (perSection.get(text.section) || 0) + 1;
    perSection.set(text.section, nth);
    return nth === 2;
  });
  const pool = secondOfSection.length ? secondOfSection : texts;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  if (pick) texts.splice(texts.indexOf(pick), 1);
  return pick;
}

const slotsFor = (type) =>
  PART_TEMPLATE.filter((spec) => spec.type === type).reduce((total, spec) => total + spec.size, 0);

const RESTATEMENT_SLOTS = slotsFor('restatement');
const SENTENCE_COMPLETION_SLOTS = slotsFor('sentence-completion');

// Three sentence-completion chapters need twelve questions and an exam holds
// sixteen, eight per section: the first two chapters take the first section
// whole, and the sixth - the only one drawn from the second section - takes
// its 5-8 rather than its 1-4. So the surplus comes off the front of the last
// section that contributes, leaving its tail.
function dropSurplusFromFinalSection(indices, questions, slots) {
  const surplus = indices.length - slots;
  if (surplus <= 0) return indices;
  const finalSection = questions[indices[indices.length - 1]].section;
  const start = indices.findIndex((index) => questions[index].section === finalSection);
  return [...indices.slice(0, start), ...indices.slice(start + surplus)];
}

// Each section holds four restatements (9-12) and the simulation has room for
// six, so the opener of each section is left out: the chapters get 10-12 from
// the first section and 10-12 from the second. Dropped by position rather than
// by the number 9 so a sitting that numbers them differently still works, and
// only while enough remain to fill the chapters - a short exam is better dealt
// whole than starved for the sake of the rule.
function dropFirstOfEachSection(indices, questions) {
  const seen = new Set();
  const kept = indices.filter((index) => {
    const { section } = questions[index];
    if (seen.has(section)) return true;
    seen.add(section);
    return false;
  });
  return kept.length >= RESTATEMENT_SLOTS ? kept : indices;
}

// Deals the parsed exam into the six Amiram chapters, one pass through the
// template. A reading chapter is always exactly one text; any parsed
// questions left over once all six chapters are filled go unused, since the
// real Amiram simulation itself is only six chapters long.
function buildParts(questions) {
  const pools = {
    'sentence-completion': [],
    restatement: [],
  };
  questions.forEach((q, index) => {
    if (pools[q.type]) pools[q.type].push(index);
  });
  pools.restatement = dropFirstOfEachSection(pools.restatement, questions);
  pools['sentence-completion'] = dropSurplusFromFinalSection(
    pools['sentence-completion'],
    questions,
    SENTENCE_COMPLETION_SLOTS
  );
  const texts = groupPassages(questions);

  const parts = [];
  const seen = {};

  const push = (type, indices, passage) => {
    seen[type] = (seen[type] || 0) + 1;
    parts.push({
      ...PART_TYPES[type],
      type,
      passage,
      indices,
      ordinal: seen[type],
      seconds: PART_SECONDS[type],
    });
  };

  for (const spec of PART_TEMPLATE) {
    if (spec.type === 'reading-comprehension') {
      const text = takeReadingText(texts);
      if (text) push(spec.type, text.indices, text.passage);
      continue;
    }

    const indices = pools[spec.type].splice(0, spec.size);
    if (indices.length) push(spec.type, indices, null);
  }

  return parts;
}

// Non-adaptive Amirnet scoring: every mandatory question carries equal
// weight regardless of position or difficulty. The proportion of correct
// answers out of the mandatory total is mapped onto the 50-150 scale.
function amirnetScore(correctCount, totalMandatory) {
  if (!totalMandatory) return 50;
  const raw = 50 + (correctCount / totalMandatory) * 100;
  return Math.min(150, Math.max(50, Math.round(raw)));
}

if (typeof module !== 'undefined') {
  module.exports = { buildParts, PART_TYPES, PART_TEMPLATE, amirnetScore };
}

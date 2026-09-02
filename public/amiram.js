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

function groupPassages(questions) {
  const texts = [];
  questions.forEach((q, index) => {
    if (q.type !== 'reading-comprehension') return;
    const current = texts[texts.length - 1];
    if (current && current.passage === q.passage) current.indices.push(index);
    else texts.push({ passage: q.passage, indices: [index] });
  });
  return texts;
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
      const text = texts.shift();
      if (text) push(spec.type, text.indices, text.passage);
      continue;
    }

    const indices = pools[spec.type].splice(0, spec.size);
    if (indices.length) push(spec.type, indices, null);
  }

  return parts;
}

if (typeof module !== 'undefined') module.exports = { buildParts, PART_TYPES, PART_TEMPLATE };

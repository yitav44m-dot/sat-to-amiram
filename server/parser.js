'use strict';

const NOISE_LINE_RE = /Copyright.*National Institute|The test or any part of it may not be taught|distributed in any form or by any means|^\s*Institute for Testing and Evaluation\.?\s*$|^\s*\d+\s*$/;
const PAGE_FOOTER_RE = /(Verbal Reasoning|Quantitative Reasoning|English).*Section.*(Winter|Spring|Summer|Autumn)\s+\d{4}/;

function cleanText(text) {
  return text.replace(/�/g, '–');
}

function stripNoise(text) {
  return text
    .split('\n')
    .filter((line) => !NOISE_LINE_RE.test(line) && !PAGE_FOOTER_RE.test(line))
    .join('\n');
}

function splitEnglishSections(fullText) {
  const marker = /ENGLISH\s+This section contains \d+ questions\./g;
  const matches = [...fullText.matchAll(marker)];
  if (matches.length < 2) {
    throw new Error(`Expected 2 English section markers, found ${matches.length}`);
  }
  const answerKeyIdx = fullText.indexOf('Answer Key');
  const firstStart = matches[0].index;
  const secondStart = matches[1].index;
  const firstText = fullText.slice(firstStart, secondStart);
  const secondEnd = answerKeyIdx > secondStart ? answerKeyIdx : fullText.length;
  const secondText = fullText.slice(secondStart, secondEnd);
  return { firstText, secondText };
}

function parseOptions(block) {
  const optRe = /\((\d)\)\s*([\s\S]*?)(?=\(\d\)|$)/g;
  const options = [];
  let m;
  while ((m = optRe.exec(block))) {
    const num = Number(m[1]);
    if (num < 1 || num > 4) continue;
    const text = cleanText(m[2].replace(/\s+/g, ' ').trim());
    if (text) options.push(text);
  }
  return options;
}

function parseSimpleQuestions(block) {
  const questions = [];
  const qRe = /(^|\n)\s*(\d{1,2})\.\s([\s\S]*?)(?=\n\s*\d{1,2}\.\s|$)/g;
  let m;
  while ((m = qRe.exec(block))) {
    const number = Number(m[2]);
    const body = m[3];
    const firstOptIdx = body.search(/\(1\)/);
    if (firstOptIdx === -1) continue;
    const stem = cleanText(body.slice(0, firstOptIdx).replace(/\s+/g, ' ').trim());
    const options = parseOptions(body.slice(firstOptIdx));
    if (stem && options.length === 4) {
      questions.push({ number, prompt: stem, options });
    }
  }
  return questions;
}

function parseReadingComprehension(block) {
  const textRe = /Text (I{1,3}V?)\s*\(Questions (\d+)-(\d+)\)\s*([\s\S]*?)\nQuestions\b[^\n]*\n([\s\S]*?)(?=Text I{1,3}V?\s*\(Questions|$)/g;
  const questions = [];
  let m;
  while ((m = textRe.exec(block))) {
    const passage = cleanText(
      m[4]
        .split('\n')
        .map((l) => l.replace(/^\(\d+\)\s?/, '').trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
    const qs = parseSimpleQuestions(m[5]);
    for (const q of qs) {
      questions.push({ ...q, passage });
    }
  }
  return questions;
}

function parseSection(rawSectionText, label) {
  const appendixIdx = rawSectionText.search(/NAME\s+A\s+I\.D\. No\.|NATIONAL INSTITUTE FOR TESTING & EVALUATION/);
  const sectionText = appendixIdx === -1 ? rawSectionText : rawSectionText.slice(0, appendixIdx);
  const scMatch = sectionText.match(/Sentence Completions? \(Questions \d+-\d+\)([\s\S]*?)(?=Restatements? \(Questions|Reading Comprehension|$)/);
  const rsMatch = sectionText.match(/Restatements? \(Questions \d+-\d+\)([\s\S]*?)(?=Reading Comprehension|$)/);
  const rcMatch = sectionText.match(/Reading Comprehension\s*\n[\s\S]*?(?=Text I\s*\(Questions)([\s\S]*)/);

  const questions = [];
  if (scMatch) {
    for (const q of parseSimpleQuestions(scMatch[1])) {
      questions.push({ ...q, type: 'sentence-completion', section: label });
    }
  }
  if (rsMatch) {
    for (const q of parseSimpleQuestions(rsMatch[1])) {
      questions.push({ ...q, type: 'restatement', section: label });
    }
  }
  if (rcMatch) {
    for (const q of parseReadingComprehension(rcMatch[1])) {
      questions.push({ ...q, type: 'reading-comprehension', section: label });
    }
  }
  questions.sort((a, b) => a.number - b.number);
  return questions;
}

function parseAnswerKey(fullText) {
  const keyBlockMatch = fullText.match(/Answer Key[\s\S]*/);
  if (!keyBlockMatch) return {};
  const keyBlock = keyBlockMatch[0];
  const sectionRe = /English\s*.\s*(First|Second) Section\s*\n\s*question number[\s\S]*?correct answer\s+(\d+)/g;
  const result = {};
  let m;
  while ((m = sectionRe.exec(keyBlock))) {
    const label = m[1];
    const digits = m[2].split('').map(Number);
    result[label] = digits;
  }
  return result;
}

function parseEnglishExam(rawText, { season, year }) {
  const clean = stripNoise(rawText);
  const { firstText, secondText } = splitEnglishSections(clean);
  const firstQuestions = parseSection(firstText, 'First');
  const secondQuestions = parseSection(secondText, 'Second');
  const answerKey = parseAnswerKey(clean);

  const attach = (questions, label) => {
    const key = answerKey[label] || [];
    return questions.map((q) => ({
      ...q,
      correctIndex: key[q.number - 1] ? key[q.number - 1] - 1 : null,
    }));
  };

  const questions = [
    ...attach(firstQuestions, 'First'),
    ...attach(secondQuestions, 'Second'),
  ];

  return {
    season,
    year,
    questionCount: questions.length,
    questions,
  };
}

module.exports = { parseEnglishExam, stripNoise, splitEnglishSections };

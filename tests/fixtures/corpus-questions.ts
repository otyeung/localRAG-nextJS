export const corpusQuestions = [
  {
    fileName: '1706.03762v7.pdf',
    question:
      'What specific hardware setup and optimizer were used to train the base and big Transformer models? Additionally, how long did the training take for each model, and what were their final BLEU scores on the WMT 2014 English-to-German dataset?',
    requiredAnswerFragments: ['P100', 'Adam', 'BLEU'],
  },
  {
    fileName: 'cymbal-starlight-2024.pdf',
    question: 'What is the cargo capacity of Cymbal Starlight?',
    requiredAnswerFragments: ['cargo'],
  },
] as const;

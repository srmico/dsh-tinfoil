import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { TinfoilDecisionsClient } from './client.js'
import { DECISION_MODELS } from './config.js'
import type { ResolvedConfig } from './config.js'
import { formatDecisionResult } from './format.js'
import type { DecisionQuestion } from './payload.js'

export interface DecisionsToolDependencies {
  config: ResolvedConfig
  client: TinfoilDecisionsClient
}

export function registerDecisionsTool(ctx: Context, deps: DecisionsToolDependencies): void {
  ctx.tools.register(defineTool({
    name: 'decisions',
    description: 'Ask typed questions about one input and get calibrated probabilities instead of generated text. Use predicate for a condition, choice for unordered options, and score for ordered levels. Answers return in question order with token usage. Probabilities are not decisions; choose your own thresholds.',
    parameters: {
      input: {
        type: 'string',
        required: true,
        description: `Text the questions are about. Up to maxInputBytes (${deps.config.maxInputBytes}) UTF-8 bytes; larger input is rejected rather than split.`,
      },
      questions: {
        type: 'array',
        required: true,
        description: `1–${deps.config.maxQuestions} questions about the same input. Names must be unique and are echoed in the answers. Each question is evaluated against the full input, so more questions cost more input tokens.`,
        items: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                type: { type: 'string', required: true, const: 'predicate', description: 'Probability that a condition is true.' },
                name: { type: 'string', required: true, description: 'Unique identifier echoed in the answer.' },
                instructions: { type: 'string', required: true, description: 'The condition to evaluate.' },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                type: { type: 'string', required: true, const: 'choice', description: 'Pick one of the supplied options.' },
                name: { type: 'string', required: true, description: 'Unique identifier echoed in the answer.' },
                instructions: { type: 'string', required: true, description: 'The question that selects an option.' },
                choices: {
                  type: 'array',
                  required: true,
                  description: `2–${deps.config.maxChoices} unique options. String and boolean values are distinct.`,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      value: { oneOf: [{ type: 'string' }, { type: 'boolean' }], required: true },
                      description: { type: 'string' },
                    },
                  },
                },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                type: { type: 'string', required: true, const: 'score', description: 'Rate against ordered levels.' },
                name: { type: 'string', required: true, description: 'Unique identifier echoed in the answer.' },
                instructions: { type: 'string', required: true, description: 'The rubric question.' },
                levels: {
                  type: 'array',
                  required: true,
                  description: `2–${deps.config.maxScoreLevels} ordered levels from lowest to highest. The score is the probability-weighted average of the level indices.`,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      label: { type: 'string', required: true, description: 'Level label, unique within the question.' },
                      description: { type: 'string' },
                    },
                  },
                },
              },
            },
          ],
        },
      },
      model: {
        type: 'string',
        enum: [...DECISION_MODELS],
        description: 'Decision model size. decision-small is fastest, decision-large most accurate; defaults to the configured model.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          model: { type: 'string', required: true },
          answers: {
            type: 'array',
            required: true,
            items: {
              oneOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    type: { type: 'string', required: true, const: 'predicate' },
                    name: { type: 'string', required: true },
                    probability: { type: 'number', required: true },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    type: { type: 'string', required: true, const: 'choice' },
                    name: { type: 'string', required: true },
                    choice: { oneOf: [{ type: 'string' }, { type: 'boolean' }], required: true },
                    confidence: { type: 'number', required: true },
                    probabilities: {
                      type: 'array',
                      required: true,
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          value: { oneOf: [{ type: 'string' }, { type: 'boolean' }], required: true },
                          probability: { type: 'number', required: true },
                        },
                      },
                    },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    type: { type: 'string', required: true, const: 'score' },
                    name: { type: 'string', required: true },
                    score: { type: 'number', required: true },
                    confidence: { type: 'number', required: true },
                    probabilities: {
                      type: 'array',
                      required: true,
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          value: { type: 'integer', required: true },
                          label: { type: 'string', required: true },
                          probability: { type: 'number', required: true },
                        },
                      },
                    },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    type: { type: 'string', required: true, const: 'refusal' },
                    name: { type: 'string', required: true },
                  },
                },
              ],
            },
          },
          usage: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              inputTokens: { type: 'integer', required: true },
              outputTokens: { type: 'integer', required: true },
              totalTokens: { type: 'integer', required: true },
            },
          },
        },
      },
      render: (_args, value): ContentBlock[] => [{ type: 'text', text: formatDecisionResult(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return deps.client.decide({
        input: args.input,
        questions: args.questions as readonly DecisionQuestion[],
        ...args.model === undefined ? {} : { model: args.model },
        signal: exec.signal,
      })
    },
    presentCall(args): GenericCallView {
      const count = args.questions.length
      return {
        card: 'generic',
        title: `Decisions: ${count} ${count === 1 ? 'question' : 'questions'} about ${args.input.length} characters`,
        kind: 'other',
      }
    },
  }))
}

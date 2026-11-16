import { Buffer } from 'node:buffer'
import type { DecisionModel } from './config.js'
import { TinfoilDecisionsError } from './errors.js'

/** Client-side limits applied before any request is sent. */
export interface DecisionLimits {
  readonly maxInputBytes: number
  readonly maxQuestions: number
  readonly maxChoices: number
  readonly maxScoreLevels: number
  readonly maxRequestBytes: number
}

/** One selectable option in a choice question. */
export interface ChoiceOption {
  readonly value: string | boolean
  /** Optional label shown by providers that support descriptions. */
  readonly description?: string
}

/** One ordered level in a score question. */
export interface ScoreLevel {
  readonly label: string
  /** Optional description shown by providers that support descriptions. */
  readonly description?: string
}

export interface PredicateQuestion {
  readonly type: 'predicate'
  readonly name: string
  readonly instructions: string
}

export interface ChoiceQuestion {
  readonly type: 'choice'
  readonly name: string
  readonly instructions: string
  readonly choices: readonly ChoiceOption[]
}

export interface ScoreQuestion {
  readonly type: 'score'
  readonly name: string
  readonly instructions: string
  readonly levels: readonly ScoreLevel[]
}

export type DecisionQuestion = PredicateQuestion | ChoiceQuestion | ScoreQuestion

export interface PredicateAnswer {
  readonly type: 'predicate'
  readonly name: string
  readonly probability: number
}

export interface ChoiceProbability {
  readonly value: string | boolean
  readonly probability: number
}

export interface ChoiceAnswer {
  readonly type: 'choice'
  readonly name: string
  readonly choice: string | boolean
  readonly confidence: number
  readonly probabilities: ChoiceProbability[]
}

export interface ScoreProbability {
  readonly value: number
  readonly label: string
  readonly probability: number
}

export interface ScoreAnswer {
  readonly type: 'score'
  readonly name: string
  readonly score: number
  readonly confidence: number
  readonly probabilities: ScoreProbability[]
}

export interface RefusalAnswer {
  readonly type: 'refusal'
  readonly name: string
}

export type DecisionAnswer = PredicateAnswer | ChoiceAnswer | ScoreAnswer | RefusalAnswer

/** Token accounting reported by the decisions endpoint. */
export interface DecisionUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
}

/** One complete decision response. */
export interface DecisionResult {
  readonly model: string
  readonly answers: DecisionAnswer[]
  readonly usage: DecisionUsage
}

const SCORE_EPSILON = 1e-9

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidResponse(reason: string, cause?: unknown): TinfoilDecisionsError {
  return new TinfoilDecisionsError(
    `Tinfoil returned an unexpected decision response: ${reason}.`,
    'TINFOIL_RESPONSE_INVALID',
    cause === undefined ? undefined : { cause },
  )
}

function invalidQuestions(message: string): TinfoilDecisionsError {
  return new TinfoilDecisionsError(message, 'QUESTIONS_INVALID')
}

function choiceKey(value: string | boolean): string {
  return typeof value === 'boolean' ? `b:${value}` : `s:${value}`
}

function isChoiceValue(value: unknown): value is string | boolean {
  return typeof value === 'string' || typeof value === 'boolean'
}

function probabilityOf(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw invalidResponse(`${field} must be a probability from 0 through 1`)
  }
  return value
}

/** Reject empty input and input over the configured UTF-8 byte cap. */
export function assertDecisionInput(input: string, maxBytes: number): void {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new TinfoilDecisionsError('The decision input must not be empty.', 'INPUT_EMPTY')
  }
  const bytes = Buffer.byteLength(input, 'utf8')
  if (bytes > maxBytes) {
    throw new TinfoilDecisionsError(
      `The decision input is ${bytes} bytes, which exceeds maxInputBytes (${maxBytes}). Split the input before asking about it; a decision evaluates one input as a whole.`,
      'INPUT_TOO_LARGE',
    )
  }
}

function assertQuestionName(name: string, index: number, seen: Set<string>): void {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw invalidQuestions(`Question ${index} must have a non-empty name.`)
  }
  if (seen.has(name)) {
    throw invalidQuestions(`Question ${index} repeats the name "${name}". Question names must be unique.`)
  }
  seen.add(name)
}

function assertInstructions(instructions: string, index: number): void {
  if (typeof instructions !== 'string' || instructions.trim().length === 0) {
    throw invalidQuestions(`Question ${index} must have non-empty instructions.`)
  }
}

function assertChoiceQuestion(question: ChoiceQuestion, index: number, limits: DecisionLimits): void {
  const choices = question.choices
  if (!Array.isArray(choices) || choices.length < 2 || choices.length > limits.maxChoices) {
    throw invalidQuestions(
      `Question ${index} must offer between 2 and ${limits.maxChoices} choices.`,
    )
  }
  const values = new Set<string>()
  for (const [choiceIndex, choice] of choices.entries()) {
    if (!isRecordLike(choice) || !isChoiceValue(choice.value)) {
      throw invalidQuestions(`Question ${index} choice ${choiceIndex} must have a string or boolean value.`)
    }
    if (typeof choice.value === 'string' && choice.value.trim().length === 0) {
      throw invalidQuestions(`Question ${index} choice ${choiceIndex} must not be an empty string.`)
    }
    const key = choiceKey(choice.value)
    if (values.has(key)) {
      throw invalidQuestions(`Question ${index} repeats the choice value ${JSON.stringify(choice.value)}.`)
    }
    values.add(key)
    if (choice.description !== undefined && typeof choice.description !== 'string') {
      throw invalidQuestions(`Question ${index} choice ${choiceIndex} description must be a string.`)
    }
  }
}

function assertScoreQuestion(question: ScoreQuestion, index: number, limits: DecisionLimits): void {
  const levels = question.levels
  if (!Array.isArray(levels) || levels.length < 2 || levels.length > limits.maxScoreLevels) {
    throw invalidQuestions(
      `Question ${index} must provide between 2 and ${limits.maxScoreLevels} ordered levels.`,
    )
  }
  const labels = new Set<string>()
  for (const [levelIndex, level] of levels.entries()) {
    if (!isRecordLike(level) || typeof level.label !== 'string' || level.label.trim().length === 0) {
      throw invalidQuestions(`Question ${index} level ${levelIndex} must have a non-empty label.`)
    }
    if (labels.has(level.label)) {
      throw invalidQuestions(`Question ${index} repeats the level label "${level.label}".`)
    }
    labels.add(level.label)
    if (level.description !== undefined && typeof level.description !== 'string') {
      throw invalidQuestions(`Question ${index} level ${levelIndex} description must be a string.`)
    }
  }
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Validate question counts, names, instructions, choices, and levels. */
export function assertDecisionQuestions(
  questions: readonly DecisionQuestion[],
  limits: DecisionLimits,
): void {
  if (questions.length === 0) {
    throw invalidQuestions('At least one question is required.')
  }
  if (questions.length > limits.maxQuestions) {
    throw invalidQuestions(
      `The request has ${questions.length} questions, which exceeds maxQuestions (${limits.maxQuestions}).`,
    )
  }
  const names = new Set<string>()
  for (const [index, question] of questions.entries()) {
    if (!isRecordLike(question)) {
      throw invalidQuestions(`Question ${index} must be an object.`)
    }
    assertQuestionName(question.name, index, names)
    assertInstructions(question.instructions, index)
    switch (question.type) {
      case 'predicate':
        break
      case 'choice':
        assertChoiceQuestion(question, index, limits)
        break
      case 'score':
        assertScoreQuestion(question, index, limits)
        break
      default:
        throw invalidQuestions(`Question ${index} has an unknown type.`)
    }
  }
}

function wireQuestions(questions: readonly DecisionQuestion[]): unknown[] {
  return questions.map(question => {
    switch (question.type) {
      case 'predicate':
        return {
          type: 'predicate',
          name: question.name,
          instructions: question.instructions,
        }
      case 'choice':
        return {
          type: 'choice',
          name: question.name,
          instructions: question.instructions,
          choices: question.choices.map(choice => ({
            value: choice.value,
            ...choice.description === undefined ? {} : { description: choice.description },
          })),
        }
      case 'score':
        return {
          type: 'score',
          name: question.name,
          instructions: question.instructions,
          levels: question.levels.map(level => ({
            label: level.label,
            ...level.description === undefined ? {} : { description: level.description },
          })),
        }
    }
  })
}

/** Validate one decision request and serialize the exact wire body. */
export function buildDecisionBody(
  input: string,
  questions: readonly DecisionQuestion[],
  model: DecisionModel,
  limits: DecisionLimits,
): string {
  assertDecisionInput(input, limits.maxInputBytes)
  assertDecisionQuestions(questions, limits)
  const body = JSON.stringify({ model, input, questions: wireQuestions(questions) })
  const bytes = Buffer.byteLength(body, 'utf8')
  if (bytes > limits.maxRequestBytes) {
    throw new TinfoilDecisionsError(
      `The decision request is ${bytes} bytes, which exceeds maxRequestBytes (${limits.maxRequestBytes}). Reduce the input or the number of questions.`,
      'REQUEST_TOO_LARGE',
    )
  }
  return body
}

function parseUsage(value: unknown): DecisionUsage {
  if (!isRecord(value)) throw invalidResponse('usage is missing')
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens'] as const) {
    const count = value[key]
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      throw invalidResponse(`usage.${key} must be a non-negative integer`)
    }
  }
  return {
    inputTokens: value.input_tokens as number,
    outputTokens: value.output_tokens as number,
    totalTokens: value.total_tokens as number,
  }
}

function answerType(value: Record<string, unknown>): string {
  if (typeof value.type !== 'string') throw invalidResponse('an answer is missing its type')
  return value.type
}

function answerName(value: Record<string, unknown>, question: DecisionQuestion): string {
  const name = value.name
  if (typeof name !== 'string' || name !== question.name) {
    throw invalidResponse(`an answer name does not match question "${question.name}"`)
  }
  return name
}

function parsePredicateAnswer(
  value: Record<string, unknown>,
  question: PredicateQuestion,
): PredicateAnswer {
  const type = answerType(value)
  if (type !== 'predicate') {
    throw invalidResponse(`question "${question.name}" returned a ${type} answer`)
  }
  return {
    type: 'predicate',
    name: answerName(value, question),
    probability: probabilityOf(value.probability, 'probability'),
  }
}

function parseChoiceAnswer(
  value: Record<string, unknown>,
  question: ChoiceQuestion,
): ChoiceAnswer {
  const type = answerType(value)
  if (type !== 'choice') {
    throw invalidResponse(`question "${question.name}" returned a ${type} answer`)
  }
  const name = answerName(value, question)
  if (!isChoiceValue(value.choice)) {
    throw invalidResponse(`question "${question.name}" returned an invalid choice value`)
  }
  const choice = value.choice
  const offered = new Set(question.choices.map(option => choiceKey(option.value)))
  if (!offered.has(choiceKey(choice))) {
    throw invalidResponse(`question "${question.name}" chose a value that was not offered`)
  }
  const confidence = probabilityOf(value.confidence, 'confidence')
  const raw = value.probabilities
  if (!Array.isArray(raw) || raw.length !== question.choices.length) {
    throw invalidResponse(`question "${question.name}" returned an incomplete probability list`)
  }
  const probabilities = new Map<string, number>()
  for (const entry of raw) {
    if (!isRecord(entry) || !isChoiceValue(entry.value)) {
      throw invalidResponse(`question "${question.name}" returned an invalid choice probability`)
    }
    const key = choiceKey(entry.value)
    if (!offered.has(key)) {
      throw invalidResponse(`question "${question.name}" returned a probability for an unoffered value`)
    }
    if (probabilities.has(key)) {
      throw invalidResponse(`question "${question.name}" repeated a choice probability`)
    }
    probabilities.set(key, probabilityOf(entry.probability, 'probability'))
  }
  return {
    type: 'choice',
    name,
    choice,
    confidence,
    probabilities: question.choices.map(option => {
      const probability = probabilities.get(choiceKey(option.value))
      if (probability === undefined) {
        throw invalidResponse(`question "${question.name}" omitted a choice probability`)
      }
      return { value: option.value, probability }
    }),
  }
}

function parseScoreAnswer(
  value: Record<string, unknown>,
  question: ScoreQuestion,
): ScoreAnswer {
  const type = answerType(value)
  if (type !== 'score') {
    throw invalidResponse(`question "${question.name}" returned a ${type} answer`)
  }
  const name = answerName(value, question)
  const levels = question.levels
  const maxScore = levels.length - 1
  const score = value.score
  if (typeof score !== 'number' || !Number.isFinite(score) || score < -SCORE_EPSILON || score > maxScore + SCORE_EPSILON) {
    throw invalidResponse(`question "${question.name}" returned a score outside its levels`)
  }
  const confidence = probabilityOf(value.confidence, 'confidence')
  const raw = value.probabilities
  if (!Array.isArray(raw) || raw.length !== levels.length) {
    throw invalidResponse(`question "${question.name}" returned an incomplete probability list`)
  }
  const probabilities = new Map<number, number>()
  for (const entry of raw) {
    if (!isRecord(entry)) {
      throw invalidResponse(`question "${question.name}" returned an invalid score probability`)
    }
    const levelValue = entry.value
    if (typeof levelValue !== 'number' || !Number.isInteger(levelValue) || levelValue < 0 || levelValue > maxScore) {
      throw invalidResponse(`question "${question.name}" returned an invalid level value`)
    }
    const level = levels[levelValue]
    if (level === undefined || entry.label !== level.label) {
      throw invalidResponse(`question "${question.name}" returned a level label that does not match its value`)
    }
    if (probabilities.has(levelValue)) {
      throw invalidResponse(`question "${question.name}" repeated a score probability`)
    }
    probabilities.set(levelValue, probabilityOf(entry.probability, 'probability'))
  }
  return {
    type: 'score',
    name,
    score,
    confidence,
    probabilities: levels.map((level, levelValue) => {
      const probability = probabilities.get(levelValue)
      if (probability === undefined) {
        throw invalidResponse(`question "${question.name}" omitted a score probability`)
      }
      return { value: levelValue, label: level.label, probability }
    }),
  }
}

function parseAnswer(value: unknown, question: DecisionQuestion, index: number): DecisionAnswer {
  if (!isRecord(value)) {
    throw invalidResponse(`answer ${index} is not an object`)
  }
  if (answerType(value) === 'refusal') {
    return { type: 'refusal', name: answerName(value, question) }
  }
  switch (question.type) {
    case 'predicate':
      return parsePredicateAnswer(value, question)
    case 'choice':
      return parseChoiceAnswer(value, question)
    case 'score':
      return parseScoreAnswer(value, question)
  }
}

/** Parse and validate one decoded decision response against the questions that produced it. */
export function parseDecisionPayload(value: unknown, questions: readonly DecisionQuestion[]): DecisionResult {
  if (!isRecord(value)) {
    throw invalidResponse('the response root is not an object')
  }
  const model = value.model
  if (typeof model !== 'string' || model.length === 0) {
    throw invalidResponse('the response model is missing')
  }
  const rawAnswers = value.answers
  if (!Array.isArray(rawAnswers)) {
    throw invalidResponse('the response answers are missing')
  }
  if (rawAnswers.length !== questions.length) {
    throw invalidResponse(
      `the response has ${rawAnswers.length} answers for ${questions.length} questions`,
    )
  }
  const answers = questions.map((question, index) => parseAnswer(rawAnswers[index], question, index))
  return { model, answers, usage: parseUsage(value.usage) }
}

/** Parse and validate one decision response body. */
export function parseDecisionBody(body: string, questions: readonly DecisionQuestion[]): DecisionResult {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch (error) {
    throw invalidResponse('the response is not JSON', error)
  }
  return parseDecisionPayload(value, questions)
}

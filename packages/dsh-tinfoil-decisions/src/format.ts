import type { DecisionAnswer, DecisionResult } from './payload.js'

function formatProbability(value: number): string {
  if (value <= 0) return '0'
  if (value < 0.001) return '<0.001'
  if (value >= 1) return '1'
  return String(Number(value.toFixed(3)))
}

function formatNumber(value: number): string {
  return String(Number(value.toFixed(3)))
}

function formatChoiceValue(value: string | boolean): string {
  return typeof value === 'boolean' ? String(value) : value
}

function formatAnswer(answer: DecisionAnswer): string[] {
  switch (answer.type) {
    case 'predicate':
      return [`${answer.name} (predicate): ${formatProbability(answer.probability)}`]
    case 'choice':
      return [
        `${answer.name} (choice): ${formatChoiceValue(answer.choice)} · confidence ${formatProbability(answer.confidence)}`,
        `  ${answer.probabilities.map(entry => `${formatChoiceValue(entry.value)} ${formatProbability(entry.probability)}`).join(' · ')}`,
      ]
    case 'score':
      return [
        `${answer.name} (score): ${formatNumber(answer.score)} · confidence ${formatProbability(answer.confidence)}`,
        `  ${answer.probabilities.map(entry => `${entry.value} ${entry.label} ${formatProbability(entry.probability)}`).join(' · ')}`,
      ]
    case 'refusal':
      return [`${answer.name} (refusal): declined`]
  }
}

/**
 * Render one complete decision result for the model.
 *
 * Every answer and probability is included; the final line reports the
 * provider's total token count so cost is visible with the answers.
 */
export function formatDecisionResult(result: DecisionResult): string {
  const count = result.answers.length
  const lines = [
    `${count} ${count === 1 ? 'answer' : 'answers'} · ${result.model}`,
    '',
  ]
  for (const answer of result.answers) {
    lines.push(...formatAnswer(answer))
  }
  lines.push(
    '',
    `usage: ${result.usage.totalTokens} tokens`,
  )
  return lines.join('\n')
}

/** Small terminal helpers: prompts that only run on a TTY, and plain output. */

import { createInterface } from 'node:readline/promises'

/** Whether this process can ask questions. */
export function isInteractive() {
  return process.stdin.isTTY === true && process.stdout.isTTY === true
}

/** Ask for a line of text, optionally offering a default. */
export async function ask(question, fallback) {
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const suffix = fallback === undefined || fallback === '' ? '' : ` [${fallback}]`
    const answer = (await readline.question(`${question}${suffix}: `)).trim()
    return answer === '' ? (fallback ?? '') : answer
  } finally {
    readline.close()
  }
}

/** Ask the user to pick one of a numbered list. */
export async function choose(question, entries) {
  process.stdout.write(`${question}\n`)
  entries.forEach((entry, index) => process.stdout.write(`  ${index + 1}) ${entry.label}\n`))
  const answer = await ask('Choose a number', '1')
  const index = Number.parseInt(answer, 10)
  return entries[Number.isFinite(index) && index >= 1 && index <= entries.length ? index - 1 : 0].value
}

/** Ask a yes/no question. */
export async function confirm(question) {
  const answer = (await ask(`${question} (y/N)`, 'n')).toLowerCase()
  return answer === 'y' || answer === 'yes'
}

/** Print one line. */
export function line(text = '') {
  process.stdout.write(`${text}\n`)
}

/** Print a warning line. */
export function warn(text) {
  process.stderr.write(`warning: ${text}\n`)
}

/** Print an error and exit non-zero. */
export function fail(text) {
  process.stderr.write(`error: ${text}\n`)
  process.exitCode = 1
}

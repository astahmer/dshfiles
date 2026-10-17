import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { classifyTurn, healthCheck } from './cli.mjs'

/**
 * The property that matters: an incomplete candidate is refused rather than
 * promoted. These cases fail before any process is spawned, so they are cheap
 * and they cover the exact bug the first real snapshot had — a payload that
 * booted but silently skipped every plugin bundle.
 */
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-lkg-test-'))
  mkdirSync(join(root, 'runtime'), { recursive: true })
  return root
}

test('refuses a snapshot whose recorded node is gone', async () => {
  const root = fixture()
  try {
    writeFileSync(join(root, 'runtime', 'node-path'), '/nonexistent/node\n')
    const health = await healthCheck(root)
    assert.equal(health.healthy, false)
    assert.equal(health.checks[0].name, 'node')
    assert.equal(health.checks[0].ok, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refuses a snapshot whose core entry is missing', async () => {
  const root = fixture()
  try {
    writeFileSync(join(root, 'runtime', 'node-path'), `${process.execPath}\n`)
    const health = await healthCheck(root)
    assert.equal(health.healthy, false)
    assert.equal(health.checks.at(-1).name, 'core')
    assert.equal(health.checks.at(-1).ok, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the launcher refuses a store without a current snapshot', () => {
  const launcher = readFileSync(new URL('./dsh-recover', import.meta.url), 'utf8')
  assert.match(launcher, /no last known good snapshot/)
  assert.match(launcher, /DSH_LKG_HOME/)
  assert.match(launcher, /readlink/)
})

/**
 * Event shapes are copied from real Session logs. The motivating failure is a
 * prompt-assembly error that broke every turn while every other check passed.
 */
const header = { type: 'request/header', data: { header: { config: { provider: 'commandcode_work', model: 'deepseek/deepseek-v4.1-flash' } } } }
const turnEnd = reason => ({ type: 'turn/end', data: { turn: 1, reason } })

test('a completed turn passes', () => {
  const verdict = classifyTurn([{ type: 'turn/start', data: { turn: 1 } }, header, turnEnd({ kind: 'completed' })])
  assert.equal(verdict.ok, true)
  assert.equal(verdict.outcome, 'completed')
  assert.match(verdict.detail, /commandcode_work\/deepseek\/deepseek-v4.1-flash/)
})

test('a prompt-assembly failure fails the check', () => {
  const verdict = classifyTurn([
    turnEnd({
      kind: 'error',
      error: { message: 'unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix"; registered variables: provider, model', code: 'UNKNOWN' },
    }),
  ])
  assert.equal(verdict.ok, false)
  assert.equal(verdict.outcome, 'host')
  assert.match(verdict.detail, /no request sent: turn failed \(UNKNOWN\)/)
})

test('a provider refusal passes, because the runtime assembled and sent the request', () => {
  for (const error of [
    { message: 'You have insufficient credits to make this request.', code: 'QUOTA' },
    { message: 'You have hit your ChatGPT usage limit (plus plan).', code: 'PI_AI_ERROR' },
    { message: 'No Claude login found. Run: claude /login', code: 'MISSING_CREDENTIAL' },
  ]) {
    const verdict = classifyTurn([header, turnEnd({ kind: 'error', error })])
    assert.equal(verdict.ok, true, error.code)
    assert.equal(verdict.outcome, 'provider')
  }
})

test('a missing adapter, a malformed request or an unseen code fails closed', () => {
  for (const code of ['NO_ADAPTER', 'INVALID_REQUEST', 'SOMETHING_NEW']) {
    assert.equal(classifyTurn([header, turnEnd({ kind: 'error', error: { message: 'x', code } })]).ok, false, code)
  }
})

test('a turn that never ends fails unless the provider is still refusing it', () => {
  assert.equal(classifyTurn([{ type: 'turn/start', data: { turn: 1 } }]).outcome, 'pending')
  assert.equal(classifyTurn([{ type: 'turn/start', data: { turn: 1 } }]).ok, false)
  const retrying = classifyTurn([
    header,
    {
      type: 'assistant/attempt',
      data: { stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'error', failure: { message: 'overloaded', code: 'SERVER' } } } }] },
    },
  ])
  assert.equal(retrying.ok, true)
  assert.equal(retrying.outcome, 'retrying')
})

test('a turn that ends any other way fails', () => {
  assert.equal(classifyTurn([header, turnEnd({ kind: 'blocked' })]).ok, false)
  assert.equal(classifyTurn([header, turnEnd({ kind: 'aborted' })]).ok, false)
})

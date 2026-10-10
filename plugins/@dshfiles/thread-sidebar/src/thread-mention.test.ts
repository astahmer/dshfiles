import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  buildThreadReferenceInsert,
  classifyThreadMentionFailure,
  decodeThreadMentionSessionId,
  summarizeThreadMentionFailure,
  threadMentionFailureCodeSchema,
} from './thread-mention.js'

test('thread reference keeps the native session mention and title presentation', () => {
  const mention = '@[Explore Agent Questions Plugin Features](dsh-session:InNlc3Npb24tZXhhbXBsZSI)'

  assert.deepEqual(
    buildThreadReferenceInsert({
      mention,
      label: 'session-example',
      displayTitle: 'Explore Agent Questions Plugin Features',
    }),
    {
      source: 'reference',
      ref: mention,
      label: 'Explore Agent Questions Plugin Features',
      appearance: 'session',
      clipboardText: mention,
    },
  )
})

test('thread mention requests decode only a non-empty session id', () => {
  assert.equal(decodeThreadMentionSessionId({ sessionId: 'session-example' }), 'session-example')
  assert.equal(decodeThreadMentionSessionId({ sessionId: '' }), null)
  assert.equal(decodeThreadMentionSessionId({ sessionId: 'session-example', label: 'untrusted' }), null)
  assert.equal(decodeThreadMentionSessionId({ sessionId: 'x'.repeat(513) }), null)
  assert.equal(decodeThreadMentionSessionId('@thread:session-example'), null)
})

test('thread mention failure diagnostics expose only safe identity fields', () => {
  const remoteFailure = Object.assign(new Error('private thread title'), { code: 'gateway/internal' })
  const parsedFailure = threadMentionFailureCodeSchema.safeParse(remoteFailure)

  assert.equal(parsedFailure.success, true)
  if (!parsedFailure.success) assert.fail('Remote failure code did not parse')
  assert.deepEqual(parsedFailure.data, { code: 'gateway/internal' })
  assert.deepEqual(
    summarizeThreadMentionFailure({
      phase: 'remote-result',
      errorName: remoteFailure.name,
      errorCode: parsedFailure.data.code,
    }),
    {
      phase: 'remote-result',
      errorName: 'Error',
      errorCode: 'gateway/internal',
    },
  )

  const thrownFailure = new TypeError('private session id')
  assert.deepEqual(summarizeThreadMentionFailure({ phase: 'resolver-exception', errorName: thrownFailure.name }), {
    phase: 'resolver-exception',
    errorName: 'TypeError',
  })
})

test('thread mention classifies Remote preflight errors without logging their messages', () => {
  const arityFailure = new Error('client api: sessionReferenceResolver/candidates expected 1 business argument(s) plus an optional AbortSignal, got 3')
  const failureKind = classifyThreadMentionFailure(arityFailure)
  const diagnostic = summarizeThreadMentionFailure({
    phase: 'resolver-exception',
    errorName: arityFailure.name,
    failureKind,
  })

  assert.equal(failureKind, 'argument-count-mismatch')
  assert.deepEqual(diagnostic, {
    phase: 'resolver-exception',
    errorName: 'Error',
    failureKind: 'argument-count-mismatch',
  })
  assert.equal(JSON.stringify(diagnostic).includes(arityFailure.message), false)
  assert.equal(classifyThreadMentionFailure(new Error('client api: candidates has no active Connection')), 'connection-unavailable')
})

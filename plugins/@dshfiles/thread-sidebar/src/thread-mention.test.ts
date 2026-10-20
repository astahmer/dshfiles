import assert from 'node:assert/strict'
import { test } from 'vitest'
import { ThreadMentionModel } from './thread-mention.js'

test('thread reference keeps the native session mention and title presentation', () => {
  const mention = '@[Explore Agent Questions Plugin Features](dsh-session:InNlc3Npb24tZXhhbXBsZSI)'

  assert.deepEqual(
    ThreadMentionModel.buildThreadReferenceInsert({
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
  assert.equal(ThreadMentionModel.decodeThreadMentionSessionId({ sessionId: 'session-example' }), 'session-example')
  assert.equal(ThreadMentionModel.decodeThreadMentionSessionId({ sessionId: '' }), null)
  assert.equal(ThreadMentionModel.decodeThreadMentionSessionId({ sessionId: 'session-example', label: 'untrusted' }), null)
  assert.equal(ThreadMentionModel.decodeThreadMentionSessionId({ sessionId: 'x'.repeat(513) }), null)
  assert.equal(ThreadMentionModel.decodeThreadMentionSessionId('@thread:session-example'), null)
})

test('thread mention failure diagnostics expose only safe identity fields', () => {
  const remoteFailure = Object.assign(new Error('private thread title'), { code: 'gateway/internal' })
  const parsedFailure = ThreadMentionModel.failureCodeSchema.safeParse(remoteFailure)

  assert.equal(parsedFailure.success, true)
  if (!parsedFailure.success) assert.fail('Remote failure code did not parse')
  assert.deepEqual(parsedFailure.data, { code: 'gateway/internal' })
  assert.deepEqual(
    ThreadMentionModel.summarizeThreadMentionFailure({
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
  assert.deepEqual(ThreadMentionModel.summarizeThreadMentionFailure({ phase: 'resolver-exception', errorName: thrownFailure.name }), {
    phase: 'resolver-exception',
    errorName: 'TypeError',
  })
})

test('thread mention classifies Remote preflight errors without logging their messages', () => {
  const arityFailure = new Error('client api: sessionReferenceResolver/candidates expected 1 business argument(s) plus an optional AbortSignal, got 3')
  const failureKind = ThreadMentionModel.classifyThreadMentionFailure(arityFailure)
  const diagnostic = ThreadMentionModel.summarizeThreadMentionFailure({
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
  assert.equal(ThreadMentionModel.classifyThreadMentionFailure(new Error('client api: candidates has no active Connection')), 'connection-unavailable')
})

test('thread mention insert requests carry the composer they address', () => {
  assert.deepEqual(ThreadMentionModel.decodeThreadMentionInsertRequest({ sessionId: 'target' }), { sessionId: 'target' })
  assert.deepEqual(ThreadMentionModel.decodeThreadMentionInsertRequest({ sessionId: 'target', hostSessionId: 'host' }), {
    sessionId: 'target',
    hostSessionId: 'host',
  })
  assert.equal(ThreadMentionModel.decodeThreadMentionInsertRequest({ sessionId: 'target', hostSessionId: '' }), null)
  assert.equal(ThreadMentionModel.decodeThreadMentionInsertRequest({ sessionId: 'target', label: 'untrusted' }), null)
  assert.equal(ThreadMentionModel.decodeThreadMentionInsertRequest('@thread:target'), null)
})

const dragDataTransfer = () => {
  const values = new Map<string, string>()
  return {
    effectAllowed: 'none',
    get types(): readonly string[] {
      return [...values.keys()]
    },
    setData: (format: string, value: string): void => {
      values.set(format, value)
    },
    getData: (format: string): string => values.get(format) ?? '',
  }
}

test('a dragged thread travels on its own drag type, never as plain text', () => {
  const dataTransfer = dragDataTransfer()

  ThreadMentionModel.writeThreadMentionDrag(dataTransfer, 'thread-42')

  assert.equal(dataTransfer.effectAllowed, 'copyMove')
  assert.deepEqual(dataTransfer.types, [ThreadMentionModel.THREAD_MENTION_MIME])
  assert.equal(dataTransfer.types.includes('text/plain'), false)
  assert.equal(ThreadMentionModel.hasThreadMentionDrag(dataTransfer), true)
  assert.equal(ThreadMentionModel.readThreadMentionDrag(dataTransfer), 'thread-42')
})

test('a drag without a thread payload is ignored, and a malformed one resolves to nothing', () => {
  const foreign = dragDataTransfer()
  foreign.setData('text/plain', 'thread-42')

  assert.equal(ThreadMentionModel.hasThreadMentionDrag(foreign), false)
  assert.equal(ThreadMentionModel.readThreadMentionDrag(foreign), null)
  assert.equal(ThreadMentionModel.hasThreadMentionDrag(null), false)
  assert.equal(ThreadMentionModel.readThreadMentionDrag(null), null)
  assert.equal(ThreadMentionModel.decodeThreadMentionDrag('not json'), null)
  assert.equal(ThreadMentionModel.decodeThreadMentionDrag(JSON.stringify({ sessionId: '' })), null)
  assert.equal(ThreadMentionModel.decodeThreadMentionDrag(JSON.stringify({ sessionId: 'thread-42', label: 'untrusted' })), null)
})

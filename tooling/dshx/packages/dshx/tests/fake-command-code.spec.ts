import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { withUnknownProperties } from '../src/schema.js'
import { startFakeCommandCode } from '../src/scratch/fake-command-code.js'

const completionChunkSchema = Schema.Struct({
  id: Schema.String,
  choices: Schema.Array(Schema.Struct({ delta: withUnknownProperties({ content: Schema.optional(Schema.String) }) })),
})

const requestCompletion = (baseUrl: string, content: string) =>
  fetch(`${baseUrl}/provider/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: 'Bearer TEST-ALPHA1', 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content }] }),
  })

const readCompletionChunks = async (response: Awaited<ReturnType<typeof fetch>>) =>
  (await response.text()).split(/\r?\n/u).flatMap(line => {
    if (!line.startsWith('data: {')) return []
    return [Schema.decodeUnknownSync(completionChunkSchema)(JSON.parse(line.slice('data: '.length)))]
  })

describe('fake Command Code provider', () => {
  it('uses the user directive before appended runtime snapshots', async () => {
    const fake = await startFakeCommandCode()
    try {
      const response = await fetch(`${fake.baseUrl}/provider/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: 'Bearer TEST-ALPHA1', 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'developer', content: 'Assistant instructions' },
            { role: 'user', content: '[[answer Trunk is `jj:main` here]]' },
            { role: 'user', content: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.' },
            { role: 'user', content: 'Time sampled while preparing turn 1, step 1: timestamp and zone.' },
          ],
        }),
      })

      expect(response.status).toBe(200)
      expect(await response.text()).toContain('Trunk is `jj:main` here')
    } finally {
      await fake.close()
    }
  })

  it('returns Markdown links and newlines verbatim inside an answer directive', async () => {
    const fake = await startFakeCommandCode()
    try {
      const answer = 'Open [preview.txt](preview.txt).\nKeep [another](alpha.txt) link.'
      const response = await requestCompletion(fake.baseUrl, `[[answer ${answer}]]`)
      const chunks = await readCompletionChunks(response)
      expect(chunks.flatMap(chunk => chunk.choices.map(choice => choice.delta.content ?? '')).join('')).toBe(answer)
    } finally {
      await fake.close()
    }
  })

  it('reports the prompt tokens a usage directive names after the answer', async () => {
    const fake = await startFakeCommandCode()
    try {
      const response = await requestCompletion(fake.baseUrl, '[[usage 76800]] [[answer Reading the codebase.]]')
      const lines = (await response.text()).split(/\r?\n/u).filter(line => line.startsWith('data: {'))
      const usageChunk = lines.find(line => line.includes('"usage"'))
      expect(usageChunk).toContain('"prompt_tokens":76800')
      expect(lines.join('\n')).toContain('Reading the codebase.')
    } finally {
      await fake.close()
    }
  })

  it('reports the weekly use a -USED key names', async () => {
    const fake = await startFakeCommandCode()
    try {
      const read = async (key: string) => await (await fetch(`${fake.baseUrl}/alpha/billing/credits`, { headers: { authorization: `Bearer ${key}` } })).text()
      expect(await read('dshx-dev-fake-key-USED37')).toContain('"weekly":{"used":37,"cap":100')
      expect(await read('dshx-dev-fake-key')).toContain('"weekly":{"used":90,"cap":100')
    } finally {
      await fake.close()
    }
  })

  it('answers the after directive once the turn has a tool result', async () => {
    const fake = await startFakeCommandCode()
    try {
      const message = '[[call write {"file_path":"a.ts","content":"x"}]] [[after Wrote `a.ts:1`.]]'
      const response = await fetch(`${fake.baseUrl}/provider/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: 'Bearer TEST-ALPHA1', 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'user', content: message },
            { role: 'assistant', content: '' },
            { role: 'tool', content: 'ok' },
          ],
        }),
      })
      const chunks = await readCompletionChunks(response)
      expect(chunks.flatMap(chunk => chunk.choices.map(choice => choice.delta.content ?? '')).join('')).toBe('Wrote `a.ts:1`.')
    } finally {
      await fake.close()
    }
  })

  it('uses distinct completion IDs and emits bounded word-sized chunks', async () => {
    const fake = await startFakeCommandCode()
    try {
      const firstResponse = await requestCompletion(fake.baseUrl, '[[answer first response]]')
      const firstChunks = await readCompletionChunks(firstResponse)
      const secondResponse = await requestCompletion(fake.baseUrl, '[[stream 1]] [[answer alpha beta gamma]]')
      const secondChunks = await readCompletionChunks(secondResponse)
      const firstId = firstChunks[0]?.id
      const secondId = secondChunks[0]?.id
      const contentOf = (chunks: typeof firstChunks) =>
        chunks.flatMap(chunk => chunk.choices.flatMap(choice => (choice.delta.content === undefined ? [] : [choice.delta.content])))

      expect(firstResponse.status).toBe(200)
      expect(secondResponse.status).toBe(200)
      expect(firstId).not.toBe(secondId)
      expect(firstChunks.every(chunk => chunk.id === firstId)).toBe(true)
      expect(secondChunks.every(chunk => chunk.id === secondId)).toBe(true)
      expect(contentOf(firstChunks)).toEqual(['first response'])
      expect(contentOf(secondChunks)).toEqual(['alpha ', 'beta ', 'gamma'])
      expect((await requestCompletion(fake.baseUrl, '[[stream 0]] [[answer rejected]]')).status).toBe(400)
    } finally {
      await fake.close()
    }
  })
})

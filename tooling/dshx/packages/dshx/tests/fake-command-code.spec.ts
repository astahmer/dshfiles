import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { startFakeCommandCode } from '../src/scratch/fake-command-code.js'

const completionChunkSchema = z.object({
  id: z.string(),
  choices: z.array(z.object({ delta: z.object({ content: z.string().optional() }).passthrough() })),
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
    return [completionChunkSchema.parse(JSON.parse(line.slice('data: '.length)))]
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

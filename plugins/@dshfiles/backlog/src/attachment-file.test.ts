import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { writeAttachmentFile } from './attachment-file.js'

const dataUrl = (mediaType: string, text: string): string => `data:${mediaType};base64,${Buffer.from(text).toString('base64')}`

describe('attachment files', () => {
  it('writes the bytes under the two ids with an extension from the media type', async () => {
    const root = await mkdtemp(join(tmpdir(), 'backlog-attachment-test-'))
    const path = await writeAttachmentFile({ id: 12, attachmentId: 'abc-def-123', dataUrl: dataUrl('image/webp', 'webp-bytes'), root })
    expect(path.endsWith('12-abc-def-123.webp')).toBe(true)
    expect(await readFile(path, 'utf8')).toBe('webp-bytes')
  })

  it('maps text and unknown media types to a usable extension', async () => {
    const root = await mkdtemp(join(tmpdir(), 'backlog-attachment-test-'))
    expect((await writeAttachmentFile({ id: 1, attachmentId: 'text-one', dataUrl: dataUrl('text/plain', 'hello'), root })).endsWith('.txt')).toBe(true)
    expect((await writeAttachmentFile({ id: 1, attachmentId: 'binary-one', dataUrl: dataUrl('application/x-thing', 'bytes'), root })).endsWith('.xthing')).toBe(
      true,
    )
  })

  it('refuses a value that is not a base64 data URL', async () => {
    await expect(writeAttachmentFile({ id: 1, attachmentId: 'bad-one', dataUrl: 'not-a-data-url' })).rejects.toThrow('base64 data URL')
  })
})

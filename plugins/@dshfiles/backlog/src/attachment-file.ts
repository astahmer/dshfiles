import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DATA_URL = /^data:([^;,]+);base64,([\s\S]+)$/

const extensionOf = (mediaType: string): string => {
  const subtype = mediaType.split('/')[1] ?? 'bin'
  const known = new Map([
    ['plain', 'txt'],
    ['svg+xml', 'svg'],
    ['octet-stream', 'bin'],
  ])
  return known.get(subtype) ?? (subtype.replace(/[^a-z0-9]/gi, '') || 'bin')
}

/**
 * Writes one attachment to a temporary file next to every other export, so an agent can hand the path to an image or
 * file reader instead of a data URL it cannot open. The name is derived from the two ids, never from the user's file
 * name, and a later export of the same attachment replaces the previous copy.
 */
export const writeAttachmentFile = async (input: {
  readonly id: number
  readonly attachmentId: string
  readonly dataUrl: string
  readonly root?: string
}): Promise<string> => {
  const match = DATA_URL.exec(input.dataUrl)
  if (match === null || match[1] === undefined || match[2] === undefined) throw new Error('The attachment is not a base64 data URL.')
  const root = input.root ?? join(tmpdir(), 'dsh-backlog-attachments')
  const path = join(root, `${String(input.id)}-${input.attachmentId}.${extensionOf(match[1])}`)
  await mkdir(root, { recursive: true })
  await writeFile(path, Buffer.from(match[2], 'base64'))
  return path
}

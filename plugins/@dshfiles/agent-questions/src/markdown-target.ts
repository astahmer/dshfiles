import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { type MarkdownFeedbackAnchor, workspaceMarkdownPathSchema } from './store.js'

const maximumDocumentBytes = 256_000
const maximumExcerptLines = 200

interface ReadMarkdownDocumentInput {
  readonly workspacePath: string
  readonly path: string
}

interface CaptureMarkdownAnchorInput extends ReadMarkdownDocumentInput {
  readonly startLine: number
  readonly endLine: number
  readonly selectedText: string
}

const isInside = (parent: string, child: string): boolean => {
  const path = relative(parent, child)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

const readBoundedMarkdown = async ({ workspacePath, path }: ReadMarkdownDocumentInput) => {
  const safePath = workspaceMarkdownPathSchema.parse(path)
  const root = await realpath(workspacePath)
  let candidate = root
  const segments = safePath.split('/')

  for (const [index, segment] of segments.entries()) {
    candidate = resolve(candidate, segment)
    const info = await lstat(candidate)
    if (info.isSymbolicLink()) throw new Error('Markdown feedback paths cannot contain symlinks.')
    const isFile = index === segments.length - 1
    if (isFile ? !info.isFile() : !info.isDirectory()) {
      throw new Error('Markdown feedback target must be a regular workspace file.')
    }
  }

  const canonicalTarget = await realpath(candidate)
  if (!isInside(root, canonicalTarget)) throw new Error('Markdown feedback target leaves the workspace.')

  const file = await open(canonicalTarget, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > maximumDocumentBytes) {
      throw new Error(`Markdown feedback documents are limited to ${maximumDocumentBytes} bytes.`)
    }

    const chunks: Buffer[] = []
    const chunk = Buffer.alloc(16_384)
    let bytesRead = 0
    let position = 0
    while (bytesRead <= maximumDocumentBytes) {
      const result = await file.read(chunk, 0, Math.min(chunk.length, maximumDocumentBytes + 1 - bytesRead), position)
      if (result.bytesRead === 0) break
      chunks.push(Buffer.from(chunk.subarray(0, result.bytesRead)))
      bytesRead += result.bytesRead
      position += result.bytesRead
    }
    if (bytesRead > maximumDocumentBytes) {
      throw new Error(`Markdown feedback documents are limited to ${maximumDocumentBytes} bytes.`)
    }

    const bytes = Buffer.concat(chunks)
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const latestTarget = await realpath(candidate)
    if (latestTarget !== canonicalTarget || !isInside(root, latestTarget)) {
      throw new Error('Markdown feedback target changed while it was being read.')
    }
    return {
      revision: createHash('sha256').update(bytes).digest('hex'),
      lines: content.split(/\r\n|\n|\r/),
    }
  } finally {
    await file.close()
  }
}

export const captureMarkdownAnchor = async (input: CaptureMarkdownAnchorInput): Promise<MarkdownFeedbackAnchor> => {
  const path = workspaceMarkdownPathSchema.parse(input.path)
  if (!Number.isSafeInteger(input.startLine)
    || !Number.isSafeInteger(input.endLine)
    || input.startLine < 1
    || input.endLine < input.startLine
    || input.endLine - input.startLine >= maximumExcerptLines) {
    throw new Error(`Markdown feedback anchors must cover at most ${maximumExcerptLines} ordered lines.`)
  }

  const document = await readBoundedMarkdown({ workspacePath: input.workspacePath, path })
  const excerpt = document.lines.slice(input.startLine - 1, input.endLine).join('\n')
  if (excerpt.length === 0 || excerpt !== input.selectedText) {
    throw new Error('Selected Markdown text does not match the requested workspace lines.')
  }

  return {
    kind: 'markdown',
    path,
    revision: document.revision,
    startLine: input.startLine,
    endLine: input.endLine,
    excerpt,
  }
}

export const currentMarkdownRevision = async (input: ReadMarkdownDocumentInput): Promise<string | null> => {
  try {
    return (await readBoundedMarkdown(input)).revision
  } catch {
    return null
  }
}

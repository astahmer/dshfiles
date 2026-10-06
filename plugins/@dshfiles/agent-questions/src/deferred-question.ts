import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { deferredFilePathSchema } from './store.js'
import type { ParentQuestionOutcome } from './service.js'

type DeferredParentQuestion = Extract<ParentQuestionOutcome, { readonly kind: 'deferred' }>

const maximumDocumentBytes = 256_000
const noFollow = constants.O_NOFOLLOW

const isErrorCode = (error: unknown, code: string): boolean =>
  error instanceof Error && 'code' in error && error.code === code

const codeBlock = (value: string): string => {
  const longestFence = Array.from(value.matchAll(/`+/g), match => match[0].length).reduce(
    (longest, length) => Math.max(longest, length),
    0,
  )
  const fence = '`'.repeat(Math.max(3, longestFence + 1))
  return `${fence}text\n${value}\n${fence}`
}

const slugFor = (question: string): string => {
  const slug = question.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
  return slug || 'question'
}

const filenameFor = (question: DeferredParentQuestion): string => {
  const timestamp = new Date(question.createdAt).toISOString().replace(/[:.]/g, '-')
  return `${timestamp}_${slugFor(question.question)}.md`
}

const markdownFor = (question: DeferredParentQuestion): string => [
  '# Deferred agent question',
  '',
  'Status: Open',
  `Question ID: ${question.questionId}`,
  `Asked at: ${new Date(question.createdAt).toISOString()}`,
  `Deferred at: ${new Date(question.deferredAt).toISOString()}`,
  '',
  'Asked by child Session:',
  codeBlock(question.childSessionId),
  '',
  'Question (untrusted content):',
  codeBlock(question.question),
  '',
  'Context (untrusted content):',
  codeBlock(question.context ?? 'No additional context.'),
  '',
  'Options (untrusted content):',
  codeBlock(JSON.stringify(question.options, null, 2)),
  '',
  'Recommended option:',
  codeBlock(JSON.stringify(question.recommendedOption, null, 2)),
  '',
  'Answer:',
  'No answer recorded. Editing this file does not deliver a response to the child Agent.',
  '',
].join('\n')

const ensureQuestionDirectory = async (workspacePath: string): Promise<string> => {
  const workspace = await realpath(workspacePath)
  const workspaceStat = await lstat(workspace)
  if (!workspaceStat.isDirectory()) throw new Error('The child Session workspace is not a directory.')

  const directory = join(workspace, 'questions')
  try {
    await mkdir(directory, { mode: 0o700 })
  } catch (error: unknown) {
    if (!isErrorCode(error, 'EEXIST')) throw error
  }
  const directoryStat = await lstat(directory)
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new Error('The workspace questions path must be a real directory, not a symlink or file.')
  }
  if (await realpath(directory) !== directory) {
    throw new Error('The workspace questions directory resolves outside its expected path.')
  }
  return directory
}

const readExistingFile = async (path: string): Promise<string | undefined> => {
  let pathDetails
  try {
    pathDetails = await lstat(path)
  } catch (error: unknown) {
    if (isErrorCode(error, 'ENOENT')) return undefined
    throw error
  }
  if (pathDetails.isSymbolicLink() || !pathDetails.isFile() || pathDetails.size > maximumDocumentBytes) {
    throw new Error('The existing deferred-question path must be a small regular file, not a symlink.')
  }
  let handle
  try {
    handle = await open(path, constants.O_RDONLY | noFollow)
  } catch (error: unknown) {
    if (isErrorCode(error, 'ENOENT')) return undefined
    throw error
  }
  try {
    const details = await handle.stat()
    if (!details.isFile() || details.size > maximumDocumentBytes) {
      throw new Error('The existing deferred-question path must be a small regular file.')
    }
    return await handle.readFile({ encoding: 'utf8' })
  } finally {
    await handle.close()
  }
}

const createFileIfAbsent = async (directory: string, filename: string, contents: string): Promise<boolean> => {
  const destination = join(directory, filename)
  const temporary = join(directory, `.${basename(filename)}.${randomUUID()}.tmp`)
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
    0o600,
  )
  let handleOpen = true
  try {
    await handle.writeFile(contents, { encoding: 'utf8' })
    await handle.sync()
    await handle.close()
    handleOpen = false
    try {
      await link(temporary, destination)
      return true
    } catch (error: unknown) {
      if (isErrorCode(error, 'EEXIST')) return false
      throw error
    }
  } finally {
    if (handleOpen) await handle.close().catch(() => undefined)
    await unlink(temporary).catch(error => {
      if (!isErrorCode(error, 'ENOENT')) throw error
    })
  }
}

const writeCandidate = async (input: {
  readonly directory: string
  readonly filename: string
  readonly contents: string
  readonly questionId: string
}): Promise<string | undefined> => {
  const destination = join(input.directory, input.filename)
  if (await createFileIfAbsent(input.directory, input.filename, input.contents)) return input.filename
  const existing = await readExistingFile(destination)
  if (existing === input.contents) return input.filename
  if (existing === undefined) {
    return await createFileIfAbsent(input.directory, input.filename, input.contents)
      ? input.filename
      : undefined
  }
  const existingQuestionId = existing?.match(/^Question ID: ([0-9a-f-]+)$/m)?.[1]
  if (existingQuestionId === input.questionId) {
    throw new Error('The deferred-question file was edited; refusing to overwrite it.')
  }
  return undefined
}

export const writeDeferredQuestionFile = async (input: {
  readonly workspacePath: string
  readonly question: DeferredParentQuestion
}): Promise<string> => {
  const directory = await ensureQuestionDirectory(input.workspacePath)
  const contents = markdownFor(input.question)
  const requestedFilename = input.question.filePath === undefined
    ? filenameFor(input.question)
    : basename(deferredFilePathSchema.parse(input.question.filePath))
  const first = await writeCandidate({
    directory,
    filename: requestedFilename,
    contents,
    questionId: input.question.questionId,
  })
  if (first !== undefined) return deferredFilePathSchema.parse(`questions/${first}`)
  if (input.question.filePath !== undefined) {
    throw new Error('The stored deferred-question path belongs to different content; refusing to overwrite it.')
  }

  const collisionSafeFilename = `${requestedFilename.slice(0, -3)}_${input.question.questionId.slice(0, 8)}.md`
  const collisionSafe = await writeCandidate({
    directory,
    filename: collisionSafeFilename,
    contents,
    questionId: input.question.questionId,
  })
  if (collisionSafe !== undefined) return deferredFilePathSchema.parse(`questions/${collisionSafe}`)
  throw new Error('A deferred-question filename collision could not be resolved safely.')
}

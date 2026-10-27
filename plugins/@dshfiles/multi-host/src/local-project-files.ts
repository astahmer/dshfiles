import { execFile } from 'node:child_process'
import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, join, posix } from 'node:path'
import { withSpan } from '@dshfiles/dshx/tracing'
import type { LocalProjectFileCandidate } from './api.js'

const maxListedFiles = 256
const maxCopyFiles = 128
const maxCopiedBytes = 50 * 1024 * 1024
const maxArchiveBytes = 55 * 1024 * 1024
const maxScanOutputBytes = 16 * 1024 * 1024
const processTimeoutMs = 30_000

export class LocalProjectFilesError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'LocalProjectFilesError'
    this.code = code
  }
}

const runBufferProcess = (input: {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly signal?: AbortSignal | undefined
  readonly maxBuffer: number
}): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    execFile(
      input.executable,
      [...input.args],
      {
        cwd: input.cwd,
        encoding: 'buffer',
        maxBuffer: input.maxBuffer,
        timeout: processTimeoutMs,
        windowsHide: true,
        signal: input.signal,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          if (input.executable === 'git' && input.args[0] === 'rev-parse' && Number(error.code) === 128) {
            reject(new LocalProjectFilesError('not-a-git-project', 'The selected local folder is not inside a Git project.'))
            return
          }
          reject(new LocalProjectFilesError('local-process-failed', `${input.executable} could not complete the local project operation.`))
          return
        }
        void stderr
        resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout))
      },
    )
  })

const decodePathList = (output: Buffer): string[] => output.toString('utf8').split('\0').filter(Boolean)

const safeRelativePath = (value: string): boolean => {
  if (value.length === 0 || value.includes('\0') || posix.isAbsolute(value)) return false
  const segments = value.split('/')
  return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
}

const pathIsCopyable = (value: string): boolean => !value.split('/').includes('node_modules')

const resolveRepositoryRoot = async (path: string, signal: AbortSignal | undefined): Promise<string> => {
  if (!isAbsolute(path)) throw new LocalProjectFilesError('local-path-not-absolute', 'Choose an absolute local project folder path.')
  let canonicalPath: string
  try {
    canonicalPath = await realpath(path)
  } catch {
    throw new LocalProjectFilesError('local-path-unavailable', 'That local project folder is not available on this machine.')
  }
  const output = await runBufferProcess({
    executable: 'git',
    args: ['rev-parse', '--show-toplevel'],
    cwd: canonicalPath,
    signal,
    maxBuffer: 64 * 1024,
  })
  const root = output.toString('utf8').trim()
  if (root.length === 0) throw new LocalProjectFilesError('not-a-git-project', 'The selected local folder is not inside a Git project.')
  try {
    return await realpath(root)
  } catch {
    throw new LocalProjectFilesError('local-path-unavailable', 'The local Git project folder is not available on this machine.')
  }
}

export const listLocalProjectFiles = async (input: {
  readonly path: string
  readonly signal?: AbortSignal | undefined
}): Promise<{ readonly root: string; readonly files: readonly LocalProjectFileCandidate[]; readonly truncated: boolean }> =>
  withSpan('local project files scan', { kind: 'internal' }, async span => {
    const root = await resolveRepositoryRoot(input.path, input.signal)
    const [untrackedOutput, ignoredOutput] = await Promise.all([
      runBufferProcess({
        executable: 'git',
        args: ['ls-files', '--others', '--exclude-standard', '-z'],
        cwd: root,
        signal: input.signal,
        maxBuffer: maxScanOutputBytes,
      }),
      runBufferProcess({
        executable: 'git',
        args: ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'],
        cwd: root,
        signal: input.signal,
        maxBuffer: maxScanOutputBytes,
      }),
    ])
    const ignored = new Set(decodePathList(ignoredOutput))
    const paths = [...new Set([...decodePathList(untrackedOutput), ...ignored])]
      .filter(path => safeRelativePath(path) && pathIsCopyable(path))
      .sort((left, right) => left.localeCompare(right))
    const candidates: LocalProjectFileCandidate[] = []
    for (const path of paths.slice(0, maxListedFiles)) {
      try {
        const entry = await lstat(join(root, path))
        if (!entry.isFile()) continue
        candidates.push({ path, bytes: entry.size, ignored: ignored.has(path), copyable: entry.size <= maxCopiedBytes })
      } catch {
        continue
      }
    }
    span.setAttributes({ 'dshfiles.multi_host.local_file_count': candidates.length })
    return { root, files: candidates, truncated: paths.length > maxListedFiles }
  })

export const createLocalProjectArchive = async (input: {
  readonly root: string
  readonly paths: readonly string[]
  readonly signal?: AbortSignal | undefined
}): Promise<Buffer> =>
  withSpan('local project files archive', { kind: 'internal' }, async span => {
    if (input.paths.length > maxCopyFiles) throw new LocalProjectFilesError('too-many-files', `Select no more than ${maxCopyFiles} local files to copy.`)
    if (input.paths.some(path => !safeRelativePath(path) || !pathIsCopyable(path))) {
      throw new LocalProjectFilesError('invalid-file-path', 'One or more selected local file paths are invalid.')
    }
    const scan = await listLocalProjectFiles({ path: input.root, signal: input.signal })
    const candidates = new Map(scan.files.map(file => [file.path, file]))
    const selected = [...new Set(input.paths)].sort((left, right) => left.localeCompare(right))
    let totalBytes = 0
    for (const path of selected) {
      const file = candidates.get(path)
      if (file === undefined) throw new LocalProjectFilesError('file-not-copyable', 'A selected local file is no longer available to copy.')
      if (!file.copyable) throw new LocalProjectFilesError('file-too-large', 'A selected local file is too large to copy.')
      totalBytes += file.bytes
      if (totalBytes > maxCopiedBytes) throw new LocalProjectFilesError('copy-size-limit', 'Selected local files exceed the 50 MB copy limit.')
    }
    if (selected.length === 0) return Buffer.alloc(0)
    const archive = await runBufferProcess({
      executable: 'tar',
      args: ['-C', scan.root, '-cf', '-', '--', ...selected],
      cwd: scan.root,
      signal: input.signal,
      maxBuffer: maxArchiveBytes,
    })
    if (archive.byteLength > maxArchiveBytes) throw new LocalProjectFilesError('archive-too-large', 'The local files archive exceeds the 55 MB transfer limit.')
    span.setAttributes({ 'dshfiles.multi_host.local_file_count': selected.length, 'dshfiles.multi_host.local_file_bytes': totalBytes })
    return archive
  })

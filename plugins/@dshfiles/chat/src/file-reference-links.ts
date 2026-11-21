import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import { parseFileReference } from './file-reference-parts.ts'

/**
 * dshfiles: inline-code file references an Agent writes (`marketplace.service.ts:318`, `src/app/cart.ts#L40`) become
 * links that open the file at that line in the side panel. The native resolver links only files the closing Turn
 * produced, so a file the Agent merely read stayed plain text and the user had to ask again.
 *
 * Recognition is a shape test, cheap enough for every code span: a file name with an extension, and either a line or
 * a directory in the path, so `console.log` or `Effect.gen` never turn into links. Finding the file waits for the
 * click: the paths this thread's tool calls named first (the file the Agent actually read), then the Host's file
 * search.
 */

const FILE_PATH = /^(?:~|\.{1,2})?\/?(?:[\w.@+-]+\/)*[\w@+-][\w.@+-]*\.[A-Za-z][A-Za-z0-9]{0,9}$/u
// `example.com:443` has a file's shape; a port after a host name is not a line.
const HOST_SUFFIX = /\.(?:com|org|net|io|local|localhost)$/iu

export interface FileReference {
  /** The path as written: absolute, workspace-relative, or a bare file name. */
  readonly path: string
  readonly line: number | undefined
}

const parse = (value: string): FileReference | undefined => {
  const written = value.trim()
  if (written === '' || /\s|:\/\//u.test(written)) return undefined
  const parts = parseFileReference(written)
  const line = parts.line === undefined ? undefined : Number(parts.line)
  if (!FILE_PATH.test(parts.path)) return undefined
  if (line === undefined && !parts.path.includes('/')) return undefined
  if (line !== undefined && !parts.path.includes('/') && HOST_SUFFIX.test(parts.path)) return undefined
  return { path: parts.path, line: line !== undefined && Number.isSafeInteger(line) && line > 0 ? line : undefined }
}

const endsWithPath = (candidate: string, written: string): boolean => {
  const tail = written.replace(/^\.\//u, '')
  return candidate === tail || candidate.endsWith(`/${tail}`)
}

/**
 * Every token of a tool call's JSON text that names a path. The data's shape differs per tool (`file_path`, a shell
 * command, a nested `arguments` string), so the text is split rather than decoded.
 */
const pathsIn = (json: string, into: Set<string>): void => {
  for (const token of json.split(/[\s\\"'`()<>[\]{},;=]+/u)) if (token.includes('/') && token.length < 1024) into.add(token.replace(/[:#].*$/u, ''))
}

/**
 * The file a reference names: itself when it carries a directory, else the one path this thread's tool calls named
 * with that ending, else the Host search's best hit with that ending. Undefined when nothing matches.
 */
const locate = async (input: {
  readonly path: string
  readonly toolPaths: () => Iterable<string>
  readonly search: (query: string) => Promise<readonly string[]>
}): Promise<string | undefined> => {
  if (input.path.includes('/')) return input.path
  const named = new Set<string>()
  for (const candidate of input.toolPaths()) if (endsWithPath(candidate, input.path)) named.add(candidate)
  if (named.size === 1) return named.values().next().value
  const hits = (await input.search(input.path).catch(() => [])).filter(hit => endsWithPath(hit, input.path))
  // Several tool paths: the Host's ranking among them, else the first one named.
  return hits.find(hit => [...named].some(candidate => endsWithPath(candidate, hit))) ?? hits[0] ?? [...named][0]
}

/**
 * A mention resolver for one Assistant reply.
 * @param ports - the reply's file opener (path and line), the thread's tool-call data, and the Host file search.
 * @returns the resolver the Markdown renderer asks for each inline code span.
 */
const create = (ports: {
  readonly openFile: (path: string, line: number | undefined) => void
  /** Each tool call of the thread as JSON text. */
  readonly toolCalls: () => Iterable<string>
  readonly search: (query: string) => Promise<readonly string[]>
}): MarkdownFileMentions => ({
  resolve: value => {
    const reference = parse(value)
    if (reference === undefined) return undefined
    return {
      label: value.trim(),
      title: value.trim(),
      open: () => {
        const toolPaths = (): Iterable<string> => {
          const paths = new Set<string>()
          for (const data of ports.toolCalls()) pathsIn(data, paths)
          return paths
        }
        void locate({ path: reference.path, toolPaths, search: ports.search }).then(found => {
          // Unfound, the editor still opens the written path and says the file does not exist there.
          ports.openFile(found ?? reference.path, reference.line)
        })
      },
    }
  },
})

export class FileReferenceLinks {
  static readonly parse = parse
  static readonly locate = locate
  static readonly create = create
}

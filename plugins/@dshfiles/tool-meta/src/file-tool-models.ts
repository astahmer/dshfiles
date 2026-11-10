import { decodeJsonSafe } from '@dshfiles/dshx/json'
import { Result, Schema } from 'effect'

/** One change of a file: the text before (null for a pure insertion) and after, as the edit tools report it. */
export interface FileHunk {
  readonly path: string
  readonly oldText: string | null
  readonly newText: string
}

/** A settled `read` window: the lines the model saw, numbered as in the file. */
export interface ReadWindow {
  /** Relative to the session root when it is under one, for the header. */
  readonly path: string
  /** The path as recorded, which is what the file opener takes. */
  readonly absolutePath: string
  readonly startLine: number
  readonly code: string
  readonly lineCount: number
  readonly totalLines: number
  readonly lang?: string | undefined
}

/** The tool-call material these models read: a part of the tool view props, so a caller needs no full block. */
export type FileToolCall =
  | { readonly phase: 'preparing' }
  | { readonly phase: 'start'; readonly toolName: string; readonly cwd?: string | undefined; readonly block: { readonly argsRaw: string } }
  | {
      readonly phase: 'result'
      readonly toolName: string
      readonly cwd?: string | undefined
      readonly block: {
        readonly argsRaw?: string | undefined
        readonly parentCallId?: string | undefined
        readonly isError: boolean
        readonly content: readonly { readonly type: string; readonly text?: string | undefined }[]
        readonly meta?: unknown
        readonly call?: { readonly argsRaw: string } | null | undefined
        readonly error?: { readonly name?: string | undefined; readonly reason?: string | undefined } | undefined
      }
    }

const lineSchema = Schema.Struct({ number: Schema.Int, text: Schema.String })
const readMetaSchema = Schema.Struct({
  path: Schema.String,
  offset: Schema.Int,
  lines: Schema.Array(lineSchema),
  totalLines: Schema.Int,
  lang: Schema.optional(Schema.String),
})
const hunkSchema = Schema.Struct({ path: Schema.String, oldText: Schema.NullOr(Schema.String), newText: Schema.String })
const diffsMetaSchema = Schema.Struct({ diffs: Schema.Array(hunkSchema) })
const writeArgsSchema = Schema.Struct({ file_path: Schema.String, content: Schema.String })
const editArgsSchema = Schema.Struct({ file_path: Schema.String })
const patchArgsSchema = Schema.Struct({ path: Schema.String, edits: Schema.Array(Schema.Struct({ old: Schema.String, new: Schema.String })) })
const pathArgsSchema = Schema.Struct({ path: Schema.String })

const READ_ENVELOPE = /^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n[\s\S]*\n<\/content>$/u

const decodeArgs = <S extends Schema.Decoder<unknown>>(schema: S, argsRaw: string | undefined): S['Type'] | undefined => {
  if (argsRaw === undefined) return undefined
  try {
    const parsed = decodeJsonSafe(schema, argsRaw)
    return Result.isSuccess(parsed) ? parsed.success : undefined
  } catch {
    return undefined
  }
}

const decodeMeta = <S extends Schema.Decoder<unknown>>(schema: S, meta: unknown): S['Type'] | undefined => {
  const decoded = Schema.decodeUnknownResult(schema)(meta)
  return Result.isSuccess(decoded) ? decoded.success : undefined
}

/** The stage a file card takes over from the native rows: a settled root call that succeeded. */
type SettledFileCall = Extract<FileToolCall, { readonly phase: 'result' }>

const settledCall = (call: FileToolCall): SettledFileCall | undefined =>
  call.phase === 'result' && call.block.parentCallId === undefined && !call.block.isError ? call : undefined

const argsRawOf = (call: FileToolCall): string | undefined =>
  call.phase === 'start' ? call.block.argsRaw : call.phase === 'result' ? call.block.call?.argsRaw : undefined

const resultText = (call: SettledFileCall): string | undefined => {
  const first = call.block.content.length === 1 ? call.block.content[0] : undefined
  return first?.type === 'text' ? first.text : undefined
}

/** A path under the session root reads relative to it, as the native rows show it. */
export const displayPath = (input: { readonly path: string; readonly cwd?: string | undefined }): string => {
  const root = input.cwd?.replace(/\/+$/, '')
  return root !== undefined && root !== '' && input.path.startsWith(`${root}/`) ? input.path.slice(root.length + 1) : input.path
}

/** The read window of a settled `read`, or undefined when its metadata is missing, malformed or not one contiguous run. */
const readWindow = (call: FileToolCall): ReadWindow | undefined => {
  const settled = settledCall(call)
  if (settled === undefined) return undefined
  const text = resultText(settled)
  if (text === undefined || !READ_ENVELOPE.test(text)) return undefined
  const meta = decodeMeta(readMetaSchema, settled.block.meta)
  if (meta === undefined || meta.lines.length === 0 || meta.offset < 1) return undefined
  const contiguous = meta.lines.every((line, index) => line.number === meta.offset + index && line.number <= meta.totalLines)
  if (!contiguous) return undefined
  return {
    path: displayPath({ path: meta.path, cwd: settled.cwd }),
    absolutePath: meta.path,
    startLine: meta.offset,
    code: meta.lines.map(line => line.text).join('\n'),
    lineCount: meta.lines.length,
    totalLines: meta.totalLines,
    lang: meta.lang,
  }
}

/**
 * The applied hunks of a settled `edit` or `write`. Both report their hunks in `meta.diffs` (the change plus three
 * context lines each); a `write` whose metadata lists none (a new file, an identical overwrite) shows its whole content.
 */
const nativeHunks = (call: FileToolCall): readonly FileHunk[] | undefined => {
  const settled = settledCall(call)
  if (settled === undefined) return undefined
  const argsRaw = argsRawOf(call)
  const label = decodeArgs(editArgsSchema, argsRaw)?.file_path
  if (label === undefined || label.trim() === '') return undefined
  const applied = decodeMeta(diffsMetaSchema, settled.block.meta)?.diffs
  if (applied !== undefined && applied.length > 0) return applied.map(hunk => ({ ...hunk, path: displayPath({ path: label, cwd: settled.cwd }) }))
  if (settled.toolName !== 'write') return undefined
  const written = decodeArgs(writeArgsSchema, argsRaw)
  return written === undefined ? undefined : [{ path: displayPath({ path: label, cwd: settled.cwd }), oldText: null, newText: written.content }]
}

/** The edits an `apply_patch` call asked for, one hunk each; identical pairs change nothing and are left out. */
const patchHunks = (call: FileToolCall): readonly FileHunk[] | undefined => {
  const args = decodeArgs(patchArgsSchema, argsRawOf(call))
  if (args === undefined) return undefined
  const path = displayPath({ path: args.path.trim(), cwd: call.phase === 'preparing' ? undefined : call.cwd })
  return args.edits.filter(edit => edit.old !== edit.new).map(edit => ({ path, oldText: edit.old === '' ? null : edit.old, newText: edit.new }))
}

export type PatchCall =
  | { readonly status: 'running'; readonly path?: string | undefined; readonly hunks?: readonly FileHunk[] | undefined }
  | { readonly status: 'failed'; readonly path?: string | undefined; readonly error: string }
  | { readonly status: 'passed'; readonly path: string; readonly hunks: readonly FileHunk[] }

/** Every stage of an `apply_patch` call: this card is its only view, so it never declines. */
const patchCall = (call: FileToolCall): PatchCall => {
  const path = decodeArgs(pathArgsSchema, argsRawOf(call))?.path.trim()
  const shown = path === undefined || path === '' ? undefined : displayPath({ path, cwd: call.phase === 'preparing' ? undefined : call.cwd })
  if (call.phase !== 'result') return { status: 'running', path: shown, hunks: patchHunks(call) }
  if (call.block.isError) {
    const text = call.block.content.flatMap(part => (part.type === 'text' && part.text !== undefined ? [part.text] : [])).join('\n')
    return { status: 'failed', path: shown, error: text === '' ? (call.block.error?.reason ?? call.block.error?.name ?? 'apply_patch failed') : text }
  }
  const hunks = patchHunks(call)
  if (shown === undefined || hunks === undefined)
    return { status: 'failed', path: shown, error: resultText(call) ?? 'The patch arguments are no longer in the loaded history.' }
  return { status: 'passed', path: shown, hunks }
}

export const FileToolModels = { readWindow, nativeHunks, patchCall }

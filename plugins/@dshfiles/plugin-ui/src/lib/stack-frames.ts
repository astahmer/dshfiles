import type { Types } from 'effect'
import type { CallFrame } from '../components/motion/call-stack-tree.js'

interface ParsedFrame {
  readonly callee: string
  readonly path: string
  readonly line: number | undefined
  readonly column: number | undefined
}

interface ParsedLine {
  readonly frame: ParsedFrame
  readonly python: boolean
  /** An `at …` line (V8 or JVM): unambiguous enough to stand without an error header when two or more follow each other. */
  readonly atFrame: boolean
}

/** One error found in command output: its header and its frames, innermost first. */
export interface StackTraceReport {
  readonly errorName: string
  readonly message: string
  readonly frames: readonly CallFrame[]
  /** The lines the report was read from, header through the last frame. */
  readonly raw: string
}

// oxlint-disable-next-line no-control-regex -- terminal colour codes are exactly what this strips
const ANSI = /\u001B\[[0-9;]*[A-Za-z]/g
/** V8: `at fn (file:1:2)`, `at async fn (file:1:2)`, `at file:1:2`. */
const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+)(?::(\d+))?\)?\s*$/
/** JVM and .NET-style: `at pkg.Class.method(File.java:12)`. */
const JVM_FRAME = /^\s*at ([\w$.<>/]+)\(([^()]*?)(?::(\d+))?\)\s*$/
/** SpiderMonkey/JavaScriptCore: `fn@file:1:2`. */
const GECKO_FRAME = /^\s*([^@\s]*)@(.+?):(\d+)(?::(\d+))?\s*$/
/** Python: `File "path", line 12, in fn`. */
const PYTHON_FRAME = /^\s*File "(.+?)", line (\d+)(?:, in (.+))?\s*$/
/** `TypeError: x`, `Uncaught Error`, `java.lang.IllegalStateException: boom`, `ValueError: bad`. */
const ERROR_HEADER = /^\s*(?:Uncaught |Exception in thread "[^"]*" )?([\w$.]*(?:Error|Exception|Exit|Interrupt|Panic|Rejection)\w*)(?::\s?(.*))?$/
/** Python prints the source line and caret markers indented under each frame. */
const PYTHON_DETAIL = /^\s{4,}\S/
/** A V8 frame with no file position (`at Array.reduce (<anonymous>)`, `at new Promise (<anonymous>)`): part of the trace, nothing to open. */
const V8_NATIVE_FRAME = /^\s*at \S.*\((?:<anonymous>|native|index \d+)\)\s*$/

/** A Gecko frame's location is a URL or an absolute path to a file with an extension, never `dir/@scope/pkg/file.ts` or `user@host`. */
const GECKO_LOCATION = /^(?:[a-z][\w+.-]*:\/\/|\/)\S*\.\w+$/i

const LIBRARY_PATH = /(?:node_modules|^node:|^internal\/|site-packages|<frozen |^java\.|^jdk\.|^kotlin\.)/

const toNumber = (value: string | undefined): number | undefined => (value === undefined ? undefined : Number(value))

const readLine = (line: string): ParsedLine | null => {
  const python = PYTHON_FRAME.exec(line)
  if (python !== null)
    return { frame: { callee: python[3] ?? '', path: python[1] ?? '', line: Number(python[2]), column: undefined }, python: true, atFrame: false }
  const jvm = JVM_FRAME.exec(line)
  if (jvm !== null && !/\s/.test(jvm[1] ?? ' '))
    return { frame: { callee: jvm[1] ?? '', path: jvm[2] ?? '', line: toNumber(jvm[3]), column: undefined }, python: false, atFrame: true }
  const v8 = V8_FRAME.exec(line)
  if (v8 !== null) return { frame: { callee: v8[1] ?? '', path: v8[2] ?? '', line: Number(v8[3]), column: toNumber(v8[4]) }, python: false, atFrame: true }
  const gecko = GECKO_FRAME.exec(line)
  if (gecko !== null && GECKO_LOCATION.test(gecko[2] ?? ''))
    return { frame: { callee: gecko[1] ?? '', path: gecko[2] ?? '', line: Number(gecko[3]), column: toNumber(gecko[4]) }, python: false, atFrame: false }
  return null
}

/** Source lines are 1-based: `file:0` is a count or an offset (`grep -c`), never a frame. */
const parseLine = (line: string): ParsedLine | null => {
  const parsed = readLine(line)
  return parsed === null || parsed.frame.line === 0 ? null : parsed
}

const fileName = (path: string): string =>
  path
    .replace(/^file:\/\//, '')
    .split(/[/\\]/)
    .at(-1) ?? path

/** `Object.<anonymous>` → receiver `Object`, name `<anonymous>`; `async run` → `run`; `new Store` stays one name. */
const splitCallee = (callee: string): Pick<CallFrame, 'receiver' | 'name'> => {
  const name = callee.replace(/^async /, '').trim()
  if (name.length === 0) return { name: '<anonymous>' }
  const dot = name.startsWith('new ') ? -1 : name.lastIndexOf('.')
  if (dot <= 0) return { name }
  return { receiver: name.slice(0, dot), name: name.slice(dot + 1) }
}

const isLibrary = (frame: ParsedFrame): boolean => LIBRARY_PATH.test(frame.path) || LIBRARY_PATH.test(frame.callee)

const toCallFrames = (parsed: readonly ParsedLine[]): readonly CallFrame[] => {
  const innermostFirst = parsed.some(entry => entry.python) ? [...parsed].reverse() : parsed
  return innermostFirst.map(({ frame }, index) => {
    const callFrame: Types.Mutable<CallFrame> = {
      id: `frame-${String(index)}`,
      ...splitCallee(frame.callee),
      file: fileName(frame.path),
      path: frame.path.replace(/^file:\/\//, ''),
      status: isLibrary(frame) ? 'existing' : 'changed',
    }
    if (frame.line !== undefined) callFrame.line = frame.line
    if (frame.column !== undefined) callFrame.column = frame.column
    return callFrame
  })
}

const parsedLines = (text: string): readonly ParsedLine[] =>
  text.split(/\r?\n/).flatMap(line => {
    const result = parseLine(line)
    return result === null ? [] : [result]
  })

/**
 * An `exception.stacktrace` (V8, JVM, Gecko or Python) as flat call frames, innermost first: the throw site leads, as in
 * a JavaScript stack. Frames in the application are `changed`, library and runtime frames `existing`. Lines that are no
 * frame (the message, `Caused by`, `...`) are skipped; an unknown format gives no frames.
 */
const parse = (stacktrace: string): readonly CallFrame[] => toCallFrames(parsedLines(stacktrace))

const headerAbove = (lines: readonly string[], first: number): { readonly at: number; readonly name: string; readonly message: string } | undefined => {
  for (let at = first - 1; at >= Math.max(0, first - 8); at--) {
    const match = ERROR_HEADER.exec(lines[at] ?? '')
    if (match === null) continue
    const rest = lines
      .slice(at + 1, first)
      .map(line => line.trim())
      .filter(line => line !== '')
    return { at, name: match[1] ?? 'Error', message: [match[2] ?? '', ...rest].filter(part => part !== '').join('\n') }
  }
  return undefined
}

/**
 * The first error with a stack trace in a command's output (a Node, Deno or Bun crash, a JVM exception, a Python
 * traceback). Undefined when the output holds none, or no error header sits above frames other than two or more `at …`
 * lines, so a stray `at x (y:1)` line or `path:count` output is not taken for a crash. Only the first trace is read: a `Caused by` chain ends it.
 */
const extract = (output: string): StackTraceReport | undefined => {
  const lines = output.replace(ANSI, '').split(/\r?\n/)
  const first = lines.findIndex(line => parseLine(line) !== null)
  if (first === -1) return undefined
  const python = parseLine(lines[first] ?? '')?.python === true
  const frames: ParsedLine[] = []
  let last = first
  for (let at = first; at < lines.length; at++) {
    const parsed = parseLine(lines[at] ?? '')
    if (parsed !== null) {
      frames.push(parsed)
      last = at
      continue
    }
    if (python ? PYTHON_DETAIL.test(lines[at] ?? '') : V8_NATIVE_FRAME.test(lines[at] ?? '')) continue
    break
  }
  if (python) {
    const messageAt = lines.findIndex((line, at) => at > last && ERROR_HEADER.test(line))
    const match = messageAt === -1 ? null : ERROR_HEADER.exec(lines[messageAt] ?? '')
    if (match === null && frames.length < 2) return undefined
    const tracebacks = lines.slice(0, first).flatMap((line, at) => (line.startsWith('Traceback') ? [at] : []))
    const start = tracebacks.at(-1) ?? first
    return {
      errorName: match?.[1] ?? 'Error',
      message: match?.[2] ?? '',
      frames: toCallFrames(frames),
      raw: lines.slice(start, messageAt === -1 ? last + 1 : messageAt + 1).join('\n'),
    }
  }
  const header = headerAbove(lines, first)
  if (header === undefined && (frames.length < 2 || !frames.every(frame => frame.atFrame))) return undefined
  return {
    errorName: header?.name ?? 'Error',
    message: header?.message ?? '',
    frames: toCallFrames(frames),
    raw: lines.slice(header?.at ?? first, last + 1).join('\n'),
  }
}

export const StackFrames = { parse, extract } as const

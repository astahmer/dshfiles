import type { CallFrame } from '@dshfiles/plugin-ui/components/motion/call-stack-tree'
import type { Types } from 'effect'

interface ParsedFrame {
  readonly callee: string
  readonly path: string
  readonly line: number | undefined
}

/** V8: `at fn (file:1:2)`, `at async fn (file:1:2)`, `at file:1:2`. */
const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+)(?::\d+)?\)?\s*$/
/** JVM and .NET-style: `at pkg.Class.method(File.java:12)`. */
const JVM_FRAME = /^\s*at ([\w$.<>/]+)\(([^()]*?)(?::(\d+))?\)\s*$/
/** SpiderMonkey/JavaScriptCore: `fn@file:1:2`. */
const GECKO_FRAME = /^\s*([^@\s]*)@(.+?):(\d+)(?::\d+)?\s*$/
/** Python: `File "path", line 12, in fn`. */
const PYTHON_FRAME = /^\s*File "(.+?)", line (\d+)(?:, in (.+))?\s*$/

const LIBRARY_PATH = /(?:node_modules|^node:|^internal\/|site-packages|<frozen |^java\.|^jdk\.|^kotlin\.)/

const parseLine = (line: string): { readonly frame: ParsedFrame; readonly python: boolean } | null => {
  const python = PYTHON_FRAME.exec(line)
  if (python !== null) return { frame: { callee: python[3] ?? '', path: python[1] ?? '', line: Number(python[2]) }, python: true }
  const jvm = JVM_FRAME.exec(line)
  if (jvm !== null && !/\s/.test(jvm[1] ?? ' '))
    return { frame: { callee: jvm[1] ?? '', path: jvm[2] ?? '', line: jvm[3] === undefined ? undefined : Number(jvm[3]) }, python: false }
  const v8 = V8_FRAME.exec(line)
  if (v8 !== null) return { frame: { callee: v8[1] ?? '', path: v8[2] ?? '', line: Number(v8[3]) }, python: false }
  const gecko = GECKO_FRAME.exec(line)
  if (gecko !== null) return { frame: { callee: gecko[1] ?? '', path: gecko[2] ?? '', line: Number(gecko[3]) }, python: false }
  return null
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

/**
 * An `exception.stacktrace` (V8, JVM, Gecko or Python) as flat call frames, innermost first: the throw site leads, as in
 * a JavaScript stack. Frames in the application are `changed`, library and runtime frames `existing`. Lines that are no
 * frame (the message, `Caused by`, `...`) are skipped; an unknown format gives no frames.
 */
const parse = (stacktrace: string): readonly CallFrame[] => {
  const parsed = stacktrace.split(/\r?\n/).flatMap(line => {
    const result = parseLine(line)
    return result === null ? [] : [result]
  })
  const innermostFirst = parsed.some(entry => entry.python) ? [...parsed].reverse() : parsed
  return innermostFirst.map(({ frame }, index) => {
    const callFrame: Types.Mutable<CallFrame> = {
      id: `frame-${String(index)}`,
      ...splitCallee(frame.callee),
      file: fileName(frame.path),
      status: LIBRARY_PATH.test(frame.path) || LIBRARY_PATH.test(frame.callee) ? 'existing' : 'changed',
    }
    if (frame.line !== undefined) callFrame.line = frame.line
    return callFrame
  })
}

export const StackFrames = { parse } as const

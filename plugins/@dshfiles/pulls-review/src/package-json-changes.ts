/**
 * Reads dependency changes of `package.json` files out of a unified patch, so a diff view can show them as a table
 * (package, previous version, new version, change kind) instead of text lines.
 *
 * A patch carries only changed lines and a little context, so each hunk tracks the objects it opens and closes. An
 * entry whose enclosing object the hunk never named is still listed when its value reads as a version range, but its
 * section is null and the file is not `confident`: such a row may be `engines.node` or an override, so a view must
 * keep the text diff on screen next to the table.
 */

export const dependencySections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const
export type DependencySection = (typeof dependencySections)[number]

export type DependencyChangeKind = 'added' | 'removed' | 'updated'

export interface DependencyChange {
  readonly name: string
  /** The section the line sits in; null when the hunk never named it. */
  readonly section: DependencySection | null
  readonly kind: DependencyChangeKind
  readonly before: string | null
  readonly after: string | null
}

export interface PackageJsonChanges {
  readonly path: string
  readonly changes: readonly DependencyChange[]
  /** Every row sits in a section the patch names, so the table can stand in for the text diff. */
  readonly confident: boolean
  /**
   * Added or removed lines that are neither a dependency entry nor a dependency section's braces (scripts, version,
   * other fields). A table that replaces the text diff names these instead of hiding them.
   */
  readonly otherLines: number
}

const ENTRY = /^\s*"([^"]+)"\s*:\s*"([^"]*)"\s*,?\s*$/
const OPEN = /^\s*"([^"]+)"\s*:\s*\{\s*$/
const CLOSE = /^\s*\}\s*,?\s*$/
const VERSION_LIKE = /^(?:[\^~<>=*]|\d|v\d|workspace:|catalog:|npm:|link:|file:|portal:|patch:|github:|git\+|git:|https?:|latest$|next$|x$)/

/** Top-level string fields that read as versions but are never dependencies. */
const TOP_LEVEL = new Set(['version', 'packageManager'])

const isSection = (value: string): value is DependencySection => (dependencySections as readonly string[]).includes(value)

const isPackageJson = (path: string): boolean => path === 'package.json' || path.endsWith('/package.json')

/** The file's path: the `+++ b/` side, then `--- a/` for a deleted file, then the `diff --git` header. */
const pathOf = (lines: readonly string[]): string | undefined => {
  const strip = (line: string | undefined): string | undefined => {
    if (line === undefined) return undefined
    const raw = line.slice(4).trim()
    return raw === '/dev/null' ? undefined : raw.replace(/^[ab]\//, '')
  }
  const header = lines[0]?.match(/^diff --git a\/(.+) b\/(.+)$/)
  return strip(lines.find(line => line.startsWith('+++ '))) ?? strip(lines.find(line => line.startsWith('--- '))) ?? header?.[2]
}

/** Where a line sits: a named dependency section, any other object, or an object the hunk never opened. */
type Context = DependencySection | 'other' | 'unknown'

interface Entry {
  readonly name: string
  readonly section: DependencySection | null
  readonly version: string
}

/** Tracks the objects a hunk opens; below them sits the object the hunk started in, which it never named. */
class HunkContext {
  private readonly opened: Context[] = []
  private start: Context = 'unknown'

  open(name: string | undefined): void {
    this.opened.push(name !== undefined && isSection(name) ? name : 'other')
  }

  close(): void {
    // Closing an object this hunk opened leaves us in the start object, which holds an object, so it is no
    // dependency section (those hold strings only). Closing one it never opened leaves for an unnamed parent.
    if (this.opened.pop() !== undefined) {
      if (this.opened.length === 0) this.start = 'other'
    } else this.start = 'unknown'
  }

  get current(): Context {
    return this.opened.at(-1) ?? this.start
  }
}

const changeOf = (before: Entry | undefined, after: Entry | undefined): DependencyChange | undefined => {
  const entry = after ?? before
  if (entry === undefined || before?.version === after?.version) return undefined
  const kind: DependencyChangeKind = before === undefined ? 'added' : after === undefined ? 'removed' : 'updated'
  return { name: entry.name, section: entry.section, kind, before: before?.version ?? null, after: after?.version ?? null }
}

const readFile = (lines: readonly string[]): { readonly changes: readonly DependencyChange[]; readonly otherLines: number } => {
  const before = new Map<string, Entry>()
  const after = new Map<string, Entry>()
  const order: string[] = []
  let otherLines = 0
  let context = new HunkContext()
  for (const line of lines) {
    if (line.startsWith('@@')) {
      context = new HunkContext()
      continue
    }
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('\\')) continue
    const marker = line[0]
    if (marker !== ' ' && marker !== '+' && marker !== '-') continue
    const changed = marker !== ' '
    const text = line.slice(1)
    const trimmed = text.trim()
    const open = text.match(OPEN)
    if (open !== null || trimmed === '{') {
      context.open(open?.[1])
      if (changed && open !== null && context.current === 'other') otherLines += 1
      continue
    }
    if (CLOSE.test(text)) {
      context.close()
      continue
    }
    if (!changed || trimmed === '') continue
    const entry = text.match(ENTRY)
    const name = entry?.[1] ?? ''
    const version = entry?.[2] ?? ''
    const where = context.current
    const dependency = entry !== null && (where === 'unknown' ? !TOP_LEVEL.has(name) && VERSION_LIKE.test(version) : where !== 'other')
    if (!dependency) {
      otherLines += 1
      continue
    }
    const section = where === 'unknown' || where === 'other' ? null : where
    const key = `${section ?? ''}:${name}`
    if (!before.has(key) && !after.has(key)) order.push(key)
    ;(marker === '+' ? after : before).set(key, { name, section, version })
  }
  const changes = order.flatMap(key => changeOf(before.get(key), after.get(key)) ?? [])
  return { changes, otherLines }
}

/** Every `package.json` in the patch that changes at least one dependency, in patch order. */
const read = (patch: string): readonly PackageJsonChanges[] =>
  patch
    .split(/^(?=diff --git )/m)
    .filter(chunk => chunk.startsWith('diff --git '))
    .flatMap((chunk): PackageJsonChanges[] => {
      const lines = chunk.split('\n')
      const path = pathOf(lines)
      if (path === undefined || !isPackageJson(path)) return []
      const { changes, otherLines } = readFile(lines)
      if (changes.length === 0) return []
      return [{ path, changes, otherLines, confident: changes.every(change => change.section !== null) }]
    })

export const PackageJsonChangesModel = { read, isPackageJson } as const

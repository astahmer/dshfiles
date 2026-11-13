import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The fork's sources import `@deepseek-ai/dsh-client-ui-conversation/client` meaning themselves, which only this
// package's tsconfig `paths` arranges. A consumer program resolves that specifier to the published package, so any
// exported `types` entry reaching the fork lands its augmentations on a second module identity (TS2717 in backlog).
const FORK_SPECIFIER = '@deepseek-ai/dsh-client-ui-conversation/client'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const forkEntry = join(root, 'src/native/index.ts')

const specifiers = (source: string): string[] =>
  [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].flatMap(match => (match[1] === undefined ? [] : [match[1]]))

const resolveRelative = (from: string, specifier: string): string | undefined => {
  const base = join(dirname(from), specifier)
  const stem = base.replace(/\.(?:js|jsx|ts|tsx)$/, '')
  return [base, `${stem}.ts`, `${stem}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find(
    candidate => /\.tsx?$/.test(candidate) && existsSync(candidate),
  )
}

const forkReach = (entry: string): string[] => {
  const seen = new Set<string>()
  const offenders: string[] = []
  const visit = (file: string): void => {
    if (seen.has(file)) return
    seen.add(file)
    if (file === forkEntry) offenders.push(relative(root, file))
    for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
      if (specifier === FORK_SPECIFIER) offenders.push(`${relative(root, file)} imports ${FORK_SPECIFIER}`)
      if (!specifier.startsWith('.')) continue
      const next = resolveRelative(file, specifier)
      if (next !== undefined) visit(next)
    }
  }
  visit(entry)
  return offenders
}

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { exports: Record<string, unknown> }
const typeEntries = Object.entries(manifest.exports).flatMap(([subpath, target]) =>
  typeof target === 'object' && target !== null && 'types' in target && typeof target.types === 'string' ? [[subpath, target.types] as const] : [],
)

describe('exported type entries', () => {
  it('lists the subpaths other plugins compile against', () => {
    expect(typeEntries.map(([subpath]) => subpath)).toContain('./rich-text-editor')
  })

  it.each(typeEntries)('%s stays outside the forked conversation module', (_subpath, types) => {
    expect(forkReach(join(root, types))).toEqual([])
  })
})

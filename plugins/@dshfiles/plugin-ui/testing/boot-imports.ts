import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

/** `import … from './x.js'` and `export … from './x.js'`; type-only forms are dropped before matching. */
const STATIC_FROM = /^\s*(?:import|export)\s[^;]*?\sfrom\s+['"](\.{1,2}\/[^'"]+)['"]/gmu
/** A bare side-effect import: `import './client.css'`. */
const STATIC_BARE = /^\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/gmu
const TYPE_ONLY = /^\s*(?:import|export)\s+type\s[^;]*?\sfrom\s+['"][^'"]+['"];?/gmu

const resolveSource = (from: string, specifier: string): string | undefined => {
  const base = resolve(dirname(from), specifier)
  const stem = base.replace(/\.(?:js|jsx|ts|tsx)$/u, '')
  for (const candidate of [base, `${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`, `${stem}/index.tsx`]) {
    if (/\.(?:ts|tsx)$/u.test(candidate) && existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * The plugin's own source files a Client entry reaches through static imports, relative to `root`: what page boot
 * parses. A module reached only through `import()` is absent, so a test can pin that a heavy view stays a lazy chunk.
 * Package imports are not followed.
 */
export function bootImports(entry: string, root: string = dirname(entry)): ReadonlySet<string> {
  const seen = new Set<string>()
  const visit = (file: string): void => {
    if (seen.has(file)) return
    seen.add(file)
    const source = readFileSync(file, 'utf8').replace(TYPE_ONLY, '')
    for (const pattern of [STATIC_FROM, STATIC_BARE]) {
      for (const match of source.matchAll(pattern)) {
        const target = match[1] === undefined ? undefined : resolveSource(file, match[1])
        if (target !== undefined) visit(target)
      }
    }
  }
  visit(resolve(entry))
  return new Set([...seen].map(file => relative(root, file).replaceAll('\\', '/')))
}

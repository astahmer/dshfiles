import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { bootImports } from '../testing/boot-imports.js'

test('follows static imports and re-exports, never import() or type-only imports', () => {
  const root = mkdtempSync(join(tmpdir(), 'boot-imports-'))
  const write = (name: string, source: string): void => writeFileSync(join(root, name), source)
  write('client.tsx', "import { a } from './a.js'\nexport { b } from './b'\nimport type { T } from './typed.js'\nimport './style.ts'\nconst view = () => import('./view.js')\n")
  write('a.ts', "import {\n  c,\n} from './c.js'\nexport const a = c\n")
  write('b.ts', 'export const b = 1\n')
  write('c.tsx', 'export const c = 1\n')
  write('typed.ts', "import './never.js'\nexport type T = 1\n")
  write('style.ts', 'export {}\n')
  write('view.tsx', "import './heavy.js'\n")
  write('heavy.ts', 'export {}\n')
  expect([...bootImports(join(root, 'client.tsx'))].sort()).toEqual(['a.ts', 'b.ts', 'c.tsx', 'client.tsx', 'style.ts'])
})

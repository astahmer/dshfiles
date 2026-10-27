import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import * as clientEntry from '../src/client/index.js'

// Build-time tooling helpers stay out of the bundled virtual module on purpose.
const BUILD_ONLY_EXPORTS = new Set(['CLIENT_SLOT_REFERENCES', 'findClientSlot', 'slotOwnerImports'])

const virtualClientExports = async (): Promise<Set<string>> => {
  const source = await readFile(new URL('../src/compiler/client/build.ts', import.meta.url), 'utf8')
  const start = source.indexOf('if (id === VIRTUAL_CLIENT_PUBLIC)')
  const end = source.indexOf("].join('\\n')", start)
  const block = source.slice(start, end)
  const names = new Set<string>()
  for (const match of block.matchAll(/export const (\w+)/gu)) names.add(match[1] ?? '')
  for (const match of block.matchAll(/export \{ ([^}]+) \}/gu))
    for (const name of (match[1] ?? '').split(',')) names.add(name.trim().split(/\s+as\s+/u).at(-1) ?? '')
  return names
}

describe('the bundled @dshfiles/dshx/client module', () => {
  it('exports every runtime value of the package entry', async () => {
    const bundled = await virtualClientExports()
    const missing = Object.keys(clientEntry).filter(name => !BUILD_ONLY_EXPORTS.has(name) && !bundled.has(name))
    expect(missing).toEqual([])
  })
})

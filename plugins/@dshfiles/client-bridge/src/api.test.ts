import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { clientBridgeApi, WINDOW_ACTION_EXAMPLES } from './api.js'

const pluginsRoot = new URL('../../', import.meta.url).pathname

/** Every client tool name an owned plugin declares with defineClientTool. */
const declaredClientTools = async (): Promise<ReadonlySet<string>> => {
  const names = new Set<string>()
  for (const plugin of await readdir(pluginsRoot)) {
    const source = join(pluginsRoot, plugin, 'src')
    const files = await readdir(source).catch(() => [])
    for (const file of files) {
      if (!/client-tools\.ts$/u.test(file)) continue
      const text = await readFile(join(source, file), 'utf8')
      if (!text.includes('defineClientTool')) continue
      for (const match of text.matchAll(/defineClientTool\(\{\s*name: '([a-z0-9_]+)'/gu)) names.add(match[1] ?? '')
    }
  }
  return names
}

describe('client bridge tool descriptions', () => {
  it('name only client tools an owned plugin still declares', async () => {
    const declared = await declaredClientTools()
    expect(declared.size).toBeGreaterThan(0)
    expect(WINDOW_ACTION_EXAMPLES.map(example => example.tool).filter(tool => !declared.has(tool))).toEqual([])
  })

  it('tell the model to act in the window when asked to open something, in both Host tools', () => {
    for (const method of [clientBridgeApi.methods.list, clientBridgeApi.methods.call]) {
      expect(method.description).toMatch(/open a file at a line in their editor \(editor_open_file\)/u)
      expect(method.description).toMatch(/When the user asks to open, show or display something/u)
    }
  })
})

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import Skill from '@deepseek-ai/dsh-skill'
import { createTestHost } from '@dshfiles/dshx/testing'
import { Schema } from 'effect'
import { expect, it } from 'vitest'
import plugin from './host.js'
import { compatSettings } from './settings.js'

it('loads the upstream Figma plugin and reports its unsupported MCP call', async () => {
  const source = Schema.decodeUnknownSync(Schema.Struct({ skills: Schema.Array(Schema.String) }))(
    JSON.parse(await readFile(new URL('../tests/fixtures/opencode-figma/skills-source.json', import.meta.url), 'utf8')),
  )
  const host = await createTestHost()
  const document = {
    ns: compatSettings.namespace,
    value: {
      plugins: [{ specifier: fileURLToPath(new URL('../tests/fixtures/opencode-figma/index.ts', import.meta.url)), options: '{}', enabled: true }],
      onUnsupported: 'report',
    },
    revision: 1,
  }
  host.ctx.provide('settings', { configure: () => () => undefined, describe: () => [document], update: async () => undefined, replace: async () => undefined })
  try {
    await host.ctx.plugin(Skill)
    const mounted = await host.mount(plugin, { packageId: '@dshfiles/opencode-compat' })
    const status = await host.tools.execute({
      callId: ToolCallId('figma-status'),
      name: 'opencode_plugins_status',
      arguments: {},
      signal: new AbortController().signal,
    })
    const result = JSON.stringify(status.content)
    expect(result).toContain('loaded')
    expect(result).toContain('ctx.mcp.transform')
    expect(source.skills.length).toBeGreaterThan(1)
    for (const skill of source.skills) {
      expect(result).toContain(skill)
      expect(await host.ctx.skills.get(skill)).toBeDefined()
    }
    await mounted.dispose()
    for (const skill of source.skills) expect(await host.ctx.skills.get(skill)).toBeUndefined()
  } finally {
    await host.dispose()
  }
})

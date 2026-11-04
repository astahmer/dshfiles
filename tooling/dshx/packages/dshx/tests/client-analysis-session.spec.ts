import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClientCapabilityAnalysis } from '../src/compiler/client/capabilities.js'

describe('client capability analysis session', () => {
  let root: string
  const write = (path: string, content: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'dshx-analysis-')))
    write(
      'src/client.tsx',
      [
        "import { defineClient, useApi } from '@dshfiles/dshx/client'",
        "import { Panel } from './panel'",
        "import { strings } from './locale'",
        'export default defineClient({ inject: [], locales: [strings], setup(ctx) { ctx.locale; return Panel } })',
      ].join('\n'),
    )
    write('src/panel.tsx', "import { useSettings } from '@dshfiles/dshx/client'\nimport './shared'\nexport const Panel = () => useSettings()\n")
    write(
      'src/locale.ts',
      "import { defineLocale } from '@dshfiles/dshx/client'\nimport './shared'\nexport const strings = defineLocale('fixture.panel', {})\n",
    )
    write('src/shared.ts', 'export const shared = 1\n')
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const askEverything = async (session: ReturnType<typeof ClientCapabilityAnalysis.session>) => {
    const entry = join(root, 'src/client.tsx')
    return {
      settings: await ClientCapabilityAnalysis.usesSettings(entry, root, session),
      api: await ClientCapabilityAnalysis.usesApi(entry, root, session),
      conversations: await ClientCapabilityAnalysis.usesConversationComponents(entry, root, session),
      locales: await ClientCapabilityAnalysis.usesLocales(entry, root, session),
      services: (await ClientCapabilityAnalysis.setupServices(entry, root, session)).services,
      namespaces: await ClientCapabilityAnalysis.localeNamespaces(entry, root, session),
    }
  }

  it('reads and parses each source once however many questions a generation asks', async () => {
    const session = ClientCapabilityAnalysis.session()
    const answers = await askEverything(session)
    expect(answers).toEqual({ settings: true, api: false, conversations: false, locales: true, services: ['locale'], namespaces: ['fixture.panel'] })
    // client, panel, locale, shared: four parses. Reads also cover the extensionless candidates that failed.
    expect(session.counts.parses).toBe(4)
    const reads = session.counts.reads
    await askEverything(session)
    expect(session.counts).toEqual({ reads, parses: 4 })
  })

  it('gives the same answers as one fresh session per question', async () => {
    const entry = join(root, 'src/client.tsx')
    const shared = await askEverything(ClientCapabilityAnalysis.session())
    expect(shared).toEqual({
      settings: await ClientCapabilityAnalysis.usesSettings(entry, root),
      api: await ClientCapabilityAnalysis.usesApi(entry, root),
      conversations: await ClientCapabilityAnalysis.usesConversationComponents(entry, root),
      locales: await ClientCapabilityAnalysis.usesLocales(entry, root),
      services: (await ClientCapabilityAnalysis.setupServices(entry, root)).services,
      namespaces: await ClientCapabilityAnalysis.localeNamespaces(entry, root),
    })
  })

  it('sees an edit only in the next generation', async () => {
    const entry = join(root, 'src/client.tsx')
    const first = ClientCapabilityAnalysis.session()
    expect(await ClientCapabilityAnalysis.usesApi(entry, root, first)).toBe(false)
    write('src/shared.ts', "import { useApi } from '@dshfiles/dshx/client'\nexport const shared = () => useApi()\n")
    expect(await ClientCapabilityAnalysis.usesApi(entry, root, ClientCapabilityAnalysis.session())).toBe(true)
  })
})

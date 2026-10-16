import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocaleNamespaceOwnershipModel } from '../src/compiler/client/locale-ownership.js'
import { clientLocaleNamespaces } from '../src/compiler/client/capabilities.js'
import { buildClient } from '../src/compiler/index.js'

const directories: string[] = []

async function localeProject(clientSource: string, localeSource?: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'dshx-locale-'))
  directories.push(root)
  await mkdir(resolve(root, 'src'), { recursive: true })
  if (localeSource !== undefined) await writeFile(resolve(root, 'src/locales.ts'), localeSource)
  await writeFile(resolve(root, 'src/client.tsx'), clientSource)
  return root
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

const LOCALE_HELPER = [
  "import { declareLocaleNamespace } from '@dshfiles/dshx/client'",
  'const dictionaries = {',
  '  en: { label: "Label" },',
  '  zh: { label: "标签" },',
  '}',
  'export const pluginLocale = declareLocaleNamespace(%NAMESPACE%, dictionaries)',
  '',
].join('\n')

const CLIENT_WITH_LOCALE = [
  "import { defineClient } from '@dshfiles/dshx/client'",
  "import { pluginLocale } from './locales.js'",
  'export default defineClient({ locales: [pluginLocale] })',
  '',
].join('\n')

const localeProjectFor = (namespace: string): Promise<string> =>
  localeProject(CLIENT_WITH_LOCALE, LOCALE_HELPER.replace('%NAMESPACE%', JSON.stringify(namespace)))

describe('locale namespace ownership', () => {
  it('reads the literal namespaces a definition claims', async () => {
    const root = await localeProjectFor('queueReorder.panel')
    expect(await clientLocaleNamespaces(resolve(root, 'src/client.tsx'), root)).toEqual(['queueReorder.panel'])
  })

  it('reads a namespace declared through an exported const', async () => {
    const root = await localeProject(
      CLIENT_WITH_LOCALE,
      [
        "import { declareLocaleNamespace } from '@dshfiles/dshx/client'",
        "const en = { label: 'Label' }",
        "const zh = { label: '标签' }",
        "export const NAMESPACE = 'queueReorder.exported'",
        'export const pluginLocale = declareLocaleNamespace(NAMESPACE, { en, zh })',
        '',
      ].join('\n'),
    )
    expect(await clientLocaleNamespaces(resolve(root, 'src/client.tsx'), root)).toEqual(['queueReorder.exported'])
  })

  it('reads several claimed namespaces', async () => {
    const root = await localeProject(
      [
        "import { defineClient, defineLocale } from '@dshfiles/dshx/client'",
        "const en = { label: 'Label' }",
        "const zh = { label: '标签' }",
        "const first = defineLocale('queueReorder.a', { en, zh })",
        "const second = defineLocale('queueReorder.b', { en, zh })",
        'export default defineClient({ locales: [first, second] })',
        '',
      ].join('\n'),
    )
    expect(await clientLocaleNamespaces(resolve(root, 'src/client.tsx'), root)).toEqual(['queueReorder.a', 'queueReorder.b'])
  })

  it('stays unknown when a namespace is not a literal', async () => {
    const root = await localeProject(
      [
        "import { defineClient, defineLocale } from '@dshfiles/dshx/client'",
        "const en = { label: 'Label' }",
        "const zh = { label: '标签' }",
        'const namespace = process.env.NAMESPACE ?? "fallback"',
        'export default defineClient({ locales: [defineLocale(namespace, { en, zh })] })',
        '',
      ].join('\n'),
    )
    expect(await clientLocaleNamespaces(resolve(root, 'src/client.tsx'), root)).toBeUndefined()
  })

  it('reports no namespaces for a definition that declares none', async () => {
    const root = await localeProject(["import { defineClient } from '@dshfiles/dshx/client'", 'export default defineClient({ setup() {} })', ''].join('\n'))
    expect(await clientLocaleNamespaces(resolve(root, 'src/client.tsx'), root)).toEqual([])
  })

  it('blocks a namespace a shipped package already registers', () => {
    const ownership = LocaleNamespaceOwnershipModel.build('@dshfiles/example')
    const conflict = LocaleNamespaceOwnershipModel.findConflict(ownership, ['conversation'])
    expect(conflict).toEqual({ namespace: 'conversation', owner: '@deepseek-ai/dsh-client-ui-conversation', reserved: true })
  })

  it('allows a namespace nobody owns', () => {
    const ownership = LocaleNamespaceOwnershipModel.build('@dshfiles/example')
    expect(LocaleNamespaceOwnershipModel.findConflict(ownership, ['conversation.queueReorder'])).toBeUndefined()
  })

  it('blocks a sibling plugin claim only once that sibling is installed', () => {
    const ownership = LocaleNamespaceOwnershipModel.build('@dshfiles/example')
    expect(LocaleNamespaceOwnershipModel.findConflict(ownership, ['shared.panel'])).toBeUndefined()
    LocaleNamespaceOwnershipModel.claim(ownership, '@dshfiles/sibling', ['shared.panel'])
    expect(LocaleNamespaceOwnershipModel.findConflict(ownership, ['shared.panel'])).toEqual({
      namespace: 'shared.panel',
      owner: '@dshfiles/sibling',
      reserved: false,
    })
  })

  it('never lets a sibling shadow a shipped namespace', () => {
    const ownership = LocaleNamespaceOwnershipModel.build('@dshfiles/example')
    LocaleNamespaceOwnershipModel.claim(ownership, '@dshfiles/sibling', ['conversation'])
    expect(LocaleNamespaceOwnershipModel.findConflict(ownership, ['conversation'])?.owner).toBe('@deepseek-ai/dsh-client-ui-conversation')
  })

  it('never conflicts with its own claims', () => {
    const ownership = LocaleNamespaceOwnershipModel.build('@dshfiles/example')
    LocaleNamespaceOwnershipModel.claim(ownership, '@dshfiles/example', ['shared.panel'])
    expect(LocaleNamespaceOwnershipModel.findConflict(ownership, ['shared.panel'])).toBeUndefined()
  })

  it('fails a build that claims a shipped namespace', async () => {
    const root = await localeProjectFor('conversation')
    await expect(
      buildClient({
        packageId: '@dshfiles/example',
        root,
        entry: 'src/client.tsx',
        outDir: 'dist',
        inject: ['@deepseek-ai/dsh-client-locale'],
      }),
    ).rejects.toMatchObject({
      code: 'DSHX2403',
      message: expect.stringContaining('"conversation"'),
      hint: expect.stringContaining('@deepseek-ai/dsh-client-ui-conversation'),
    })
  })

  it('builds a plugin that claims a namespace it owns', async () => {
    const root = await localeProjectFor('queueReorder.panel')
    await buildClient({
      packageId: '@dshfiles/example',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
      inject: ['@deepseek-ai/dsh-client-locale'],
    })
  })

  it('does not reject a dynamic namespace claim', async () => {
    const root = await localeProject(
      [
        "import { defineClient, defineLocale } from '@dshfiles/dshx/client'",
        "const en = { label: 'Label' }",
        "const zh = { label: '标签' }",
        'const namespace = process.env.NAMESPACE ?? "conversation"',
        'export default defineClient({ locales: [defineLocale(namespace, { en, zh })] })',
        '',
      ].join('\n'),
    )
    await buildClient({
      packageId: '@dshfiles/example',
      root,
      entry: 'src/client.tsx',
      outDir: 'dist',
      inject: ['@deepseek-ai/dsh-client-locale'],
    })
  })
})

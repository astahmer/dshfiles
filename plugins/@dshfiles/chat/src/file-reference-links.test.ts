import { describe, expect, it } from 'vitest'
import { FileReferenceLinks } from './file-reference-links.ts'

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

const fixture = (input: { readonly toolCalls?: readonly unknown[]; readonly hits?: readonly string[] }) => {
  const opened: Array<{ readonly path: string; readonly line: number | undefined }> = []
  const searched: string[] = []
  const mentions = FileReferenceLinks.create({
    openFile: (path, line) => void opened.push({ path, line }),
    toolCalls: () => (input.toolCalls ?? []).map(data => JSON.stringify(data)),
    search: async query => {
      searched.push(query)
      return input.hits ?? []
    },
  })
  return { opened, searched, mentions }
}

describe('file reference links', () => {
  it('links file names with a line and paths with a directory, never code identifiers or hosts', () => {
    for (const value of ['marketplace.service.ts:318', 'fn-wrapper.ts#L52', 'apps/webapp/src/app/cart.ts', './README.md:10', 'root-stepper.store.ts:30-40'])
      expect(FileReferenceLinks.parse(value), value).toBeDefined()
    for (const value of [
      'console.log',
      'Effect.gen',
      'README.md',
      'effect/Schema',
      'localhost:3080',
      'example.com:443',
      'https://x.dev/a.ts',
      'npm run build',
      '127.0.0.1:80',
    ])
      expect(FileReferenceLinks.parse(value), value).toBeUndefined()
    expect(FileReferenceLinks.parse('marketplace.service.ts:318')).toEqual({ path: 'marketplace.service.ts', line: 318 })
  })

  it('opens the file the thread read at the written line, without searching', async () => {
    const read = '/Users/me/front-platform/apps/webapp/src/app/core/marketplace.service.ts'
    const { opened, searched, mentions } = fixture({
      toolCalls: [{ name: 'read', arguments: JSON.stringify({ file_path: read }) }, { command: 'grep -n inject apps/webapp/src/other.ts' }],
    })
    const target = mentions.resolve('marketplace.service.ts:318')
    expect(target?.title).toBe('marketplace.service.ts:318')
    target?.open()
    await settle()
    expect(opened).toEqual([{ path: read, line: 318 }])
    expect(searched).toEqual([])
  })

  it('falls back to the Host file search for a file the thread never named, and to the written path when nothing matches', async () => {
    const found = fixture({ hits: ['apps/webapp/src/top-up.service.spec.ts', 'apps/webapp/src/top-up.service.ts'] })
    found.mentions.resolve('top-up.service.ts:43')?.open()
    await settle()
    expect(found.opened).toEqual([{ path: 'apps/webapp/src/top-up.service.ts', line: 43 }])
    const missing = fixture({})
    missing.mentions.resolve('gone.ts:7')?.open()
    await settle()
    expect(missing.opened).toEqual([{ path: 'gone.ts', line: 7 }])
  })

  it('opens a path with a directory as written, and leaves plain code alone', async () => {
    const { opened, searched, mentions } = fixture({})
    mentions.resolve('src/app/cart.ts#L12')?.open()
    await settle()
    expect(opened).toEqual([{ path: 'src/app/cart.ts', line: 12 }])
    expect(searched).toEqual([])
    expect(mentions.resolve('doodSignal')).toBeUndefined()
  })
})

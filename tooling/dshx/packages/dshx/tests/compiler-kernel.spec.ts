import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'
import { CompilerKernel } from '../src/compiler/kernel.js'

// Use Vite's real result union instead of a hand-written Rollup output lookalike.
describe('compiler build result boundary', () => {
  it.each([null, undefined, 1, {}, { on: false, close() {} }, { on() {}, close: false }, { on: undefined, close: undefined }])(
    'rejects malformed runtime watchers: %s',
    result => {
      // @ts-expect-error JavaScript callers can violate Vite's declared result union.
      expect(() => CompilerKernel.buildWatcher(result, 'client', 'DSHX1103')).toThrow('Expected one client watcher result.')
    },
  )

  it.each([null, undefined, 1, {}, { output: false }])('rejects malformed completed outputs: %s', result => {
    // @ts-expect-error JavaScript callers can violate Vite's declared result union.
    expect(() => CompilerKernel.buildReport(result, 'host', 'index.js', '/unused', false, 'DSHX1304')).toThrow('Expected one completed build output.')
  })

  it.each([null, undefined, 1, {}, { output: null }, { output: false }])('rejects malformed singleton completed outputs: %s', result => {
    // @ts-expect-error JavaScript callers can violate Vite's declared output element type.
    expect(() => CompilerKernel.buildReport([result], 'host', 'index.js', '/unused', false, 'DSHX1304')).toThrow('Expected one completed build output.')
  })

  it('rejects empty completed output arrays', () => {
    expect(() => CompilerKernel.buildReport([], 'host', 'index.js', '/unused', false, 'DSHX1304')).toThrow('Expected one build output, received 0.')
  })

  it('reports completed outputs, rejects wrong modes and closes a real watcher', async () => {
    const parent = await realpath(tmpdir())
    const root = await realpath(await mkdtemp(join(parent, 'dshx-kernel-result-')))
    if (dirname(root) !== parent) throw new Error('Unexpected kernel fixture directory')
    const input = join(root, 'entry.js')
    const outDir = join(root, 'dist')
    await writeFile(input, 'export const result = 1\n')
    const config = {
      root,
      configFile: false as const,
      logLevel: 'silent' as const,
      build: { write: false, minify: false as const, rolldownOptions: { input, output: { format: 'es' as const } } },
    }
    let watcher: Awaited<ReturnType<typeof build>> | undefined
    try {
      const output = await build(config)
      const report = CompilerKernel.buildReport(output, 'host', 'index.js', outDir, true, 'DSHX1304')
      expect(report.output).toContainEqual({ fileName: 'index.d.ts', type: 'declaration' })
      expect(report.output.some(item => item.type === 'chunk')).toBe(true)
      expect(() => CompilerKernel.buildWatcher(output, 'host', 'DSHX1304')).toThrow('Expected one host watcher result.')
      if (Array.isArray(output) || !('output' in output)) throw new Error('Expected one completed output from Vite')
      expect(() => CompilerKernel.buildReport([output, output], 'host', 'index.js', outDir, false, 'DSHX1304')).toThrow(
        'Expected one build output, received 2.',
      )
      expect(CompilerKernel.buildReport([output], 'host', 'index.js', outDir, false, 'DSHX1304').output).toEqual(
        report.output.filter(item => item.type !== 'declaration'),
      )
      await mkdir(outDir)
      const watched = await build({ ...config, build: { ...config.build, watch: {} } })
      watcher = watched
      expect(() => CompilerKernel.buildReport(watched, 'host', 'index.js', outDir, false, 'DSHX1304')).toThrow('Expected one completed build output.')
      const owned = CompilerKernel.buildWatcher(watched, 'host', 'DSHX1304')
      expect(owned).toBe(watched)
      expect(owned.on('event', () => undefined)).toBe(watched)
    } finally {
      if (watcher !== undefined && !Array.isArray(watcher) && 'close' in watcher) await watcher.close()
      // root is the exact private directory resolved and checked before the test.
      await rm(root, { recursive: true })
    }
  })
})

import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildModule } from '../src/compiler/module/build.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('shared module build', () => {
  it('names the artifact after the module even when its entry file has another name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshx-module-build-'))
    roots.push(root)
    await mkdir(join(root, 'src/contract'), { recursive: true })
    await writeFile(join(root, 'src/contract/index.ts'), "export const contract = 'ok'\n")

    const result = await buildModule({ packageId: '@fixture/module', name: 'contract', entry: 'src/contract/index.ts', outDir: 'dist', root, sourcemap: false })

    expect(result.output.map(entry => entry.fileName)).toContain('contract.js')
    expect(await readdir(join(root, 'dist'))).toContain('contract.js')
  })
})

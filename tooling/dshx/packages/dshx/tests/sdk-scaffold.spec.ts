import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { renderProjectTemplate } from '../../create-dshx/src/templates.js'
import { resolveDshxConfig } from '../src/config/resolve.js'
import { checkPackageTargets, checkProjectManifest } from '../src/project/index.js'
import { buildClient, buildHost } from '../src/compiler/index.js'
import { applyManifestRepairPlan, createManifestRepairPlan } from '../src/project/repair.js'
import { typecheckProject } from '../src/project/typecheck.js'
import { testProject } from '../src/toolchain/index.js'

describe('SDK-first templates', () => {
  it.each(['basic', 'ui', 'tool', 'full-stack'] as const)('builds and validates the %s native bundle', async template => {
    const root = await mkdtemp(resolve(tmpdir(), 'dshx-sdk-template-'))
    try {
      for (const file of renderProjectTemplate(
        { packageId: 'my_plugin', dshxVersion: '0.1.4-preview.3', dshVersion: '0.2.0-rc.2', dshRange: '>=0.2.0-rc.1 <0.3.0-0' },
        template,
        'none',
      )) {
        await mkdir(resolve(root, file.path, '..'), { recursive: true })
        await writeFile(resolve(root, file.path), file.contents)
      }
      await mkdir(resolve(root, 'node_modules/@becomeopc'), { recursive: true })
      await symlink(fileURLToPath(new URL('..', import.meta.url)), resolve(root, 'node_modules/@dshfiles/dshx'))
      await symlink(fileURLToPath(new URL('../node_modules/@deepseek-ai', import.meta.url)), resolve(root, 'node_modules/@deepseek-ai'))
      await symlink(fileURLToPath(new URL('../../../node_modules/vitest', import.meta.url)), resolve(root, 'node_modules/vitest'))
      await symlink(fileURLToPath(new URL('../node_modules/react', import.meta.url)), resolve(root, 'node_modules/react'))
      await symlink(fileURLToPath(new URL('../node_modules/@types', import.meta.url)), resolve(root, 'node_modules/@types'))
      const config = await resolveDshxConfig({ cwd: root })
      expect((await typecheckProject(root)).diagnostics).toEqual([])
      const output: string[] = []
      const stream = new PassThrough()
      stream.on('data', chunk => output.push(String(chunk)))
      const result = await testProject(root, { stdout: stream, stderr: stream })
      if (result !== 0) throw new Error(`Generated ${template} tests failed (${result}):\n${output.join('')}`)
      expect(await checkProjectManifest(config)).toEqual([])
      if (template === 'ui') {
        const manifest = {
          ...config.manifest,
          dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: [], external: [], immediately: false } },
        }
        await writeFile(config.packageFile, JSON.stringify(manifest))
        expect(await checkProjectManifest(config)).toContainEqual(expect.objectContaining({ code: 'DSHX4222' }))
        const plan = await createManifestRepairPlan(config)
        expect(plan.changedFiles).toEqual([config.packageFile])
        await applyManifestRepairPlan(plan)
        expect(await checkProjectManifest(config)).toEqual([])
        expect((await createManifestRepairPlan(config)).changedFiles).toEqual([])
      }
      await buildHost({
        root,
        packageId: config.packageId,
        ...(config.hostEntry === undefined ? {} : { entry: config.hostEntry }),
        outDir: config.outDir,
        declarations: true,
      })
      if (config.clientEntry) {
        const inject = (config.manifest.dsh as { client: { inject: string[] } }).client.inject
        await buildClient({ root, packageId: config.packageId, entry: config.clientEntry, outDir: config.outDir, inject, declarations: true })
      }
      expect(await checkPackageTargets(config)).toEqual([])
      const patch = await readFile(resolve(root, 'cordis.patch.yml'), 'utf8')
      expect(patch).toContain('id: my-plugin')
      if (template === 'full-stack') expect(await readFile(resolve(root, 'src/settings.ts'), 'utf8')).toContain("namespace: 'my-plugin'")
      if (template === 'basic' || template === 'tool') {
        expect(config.clientEntry).toBeUndefined()
        expect(config.manifest.dsh).not.toHaveProperty('client')
        expect(config.manifest.exports).not.toHaveProperty('./client')
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

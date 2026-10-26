import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOL_2_COMPATIBILITY } from '../src/compat/protocol-2.js'
import { resolveDshxConfig } from '../src/config/resolve.js'
import { ManifestRepairService } from '../src/project/repair.js'

const roots: string[] = []

async function project(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'dshx-repair-'))
  roots.push(root)
  await writeFile(resolve(root, 'package.json'), JSON.stringify({ name: 'repair-demo', type: 'module', exports: {} }, null, 2))
  await writeFile(resolve(root, 'cordis.patch.yml'), '- insert: []\n')
  await writeFile(resolve(root, 'src-client.tsx'), 'export default {}\n')
  await writeFile(resolve(root, 'dshx.config.ts'), 'export default { client: { entry: "src-client.tsx" } }\n')
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('deterministic manifest repair plan', () => {
  it('plans only adapter-derived missing metadata and exposes a diff', async () => {
    const root = await project()
    const resolved = await resolveDshxConfig({ cwd: root })
    const plan = await ManifestRepairService.createPlan(resolved)
    expect(plan.changedFiles).toEqual([resolved.packageFile])
    expect(plan.diff).toContain('--- ')
    const manifest = JSON.parse(plan.files[0]!.after) as Record<string, unknown>
    expect(manifest.exports).toMatchObject({
      '.': './dist/index.js',
      './client': './dist/client.js',
      './cordis.patch.yml': './cordis.patch.yml',
      './package.json': './package.json',
    })
    expect(manifest.dsh).toMatchObject({ bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web', inject: [], external: [], immediately: false } })
  })

  it('repairs an optional native service edge from a literal setup and leaves immediate services alone', async () => {
    const root = await project()
    await writeFile(
      resolve(root, 'src-client.tsx'),
      [
        "import { defineClient } from '@dshfiles/dshx/client'",
        "export default defineClient({ inject: ['layout'], setup(ctx) { void ctx.layout.panelInfo; void ctx.slots } })",
        '',
      ].join('\n'),
    )
    const resolved = await resolveDshxConfig({ cwd: root })
    const plan = await ManifestRepairService.createPlan(resolved)
    const manifest = JSON.parse(plan.files[0]!.after) as {
      dsh: { client: { inject: string[] } }
      peerDependencies: Record<string, string>
    }
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-layout')
    expect(manifest.dsh.client.inject).not.toContain('@deepseek-ai/dsh-client-ui-conversation')
    expect(manifest.dsh.client.inject).not.toContain('@deepseek-ai/dsh-client-ui-renderer')
    expect(manifest.peerDependencies['@deepseek-ai/dsh-client-ui-layout']).toBe(PROTOCOL_2_COMPATIBILITY.dshRange)
  })

  it('declares typed SDK providers as peers and preserves existing peer ranges', async () => {
    const root = await project()
    await writeFile(
      resolve(root, 'package.json'),
      JSON.stringify({ name: 'repair-demo', type: 'module', peerDependencies: { '@deepseek-ai/dsh': '>=0.2.0-rc.1 <0.3.0-0' } }, null, 2),
    )
    await writeFile(
      resolve(root, 'src-client.tsx'),
      ["import { defineClientPlugin } from '@dshfiles/dshx/client'", "export default defineClientPlugin({ id: 'repair-demo', uses: ['ui'] })", ''].join('\n'),
    )
    const resolved = await resolveDshxConfig({ cwd: root })
    const plan = await ManifestRepairService.createPlan(resolved)
    const manifest = JSON.parse(plan.files[0]!.after) as {
      dsh: { client: { inject: string[] } }
      peerDependencies: Record<string, string>
    }
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-renderer')
    expect(manifest.peerDependencies['@deepseek-ai/dsh-client-ui-renderer']).toBe(PROTOCOL_2_COMPATIBILITY.dshRange)
    expect(manifest.peerDependencies['@deepseek-ai/dsh']).toBe('>=0.2.0-rc.1 <0.3.0-0')
  })

  it('does not overwrite conflicting fields and leaves correct projects unchanged', async () => {
    const root = await project()
    await writeFile(
      resolve(root, 'package.json'),
      JSON.stringify({ name: 'repair-demo', type: 'module', exports: { '.': './custom.js' }, dsh: { bundle: { patch: './other.yml' } } }, null, 2),
    )
    const resolved = await resolveDshxConfig({ cwd: root })
    const plan = await ManifestRepairService.createPlan(resolved)
    expect(plan.diff).toContain('custom.js')
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: 'DSHX4142', severity: 'warning' }))
  })

  it('applies a reviewed plan without changing source files', async () => {
    const root = await project()
    const resolved = await resolveDshxConfig({ cwd: root })
    const before = await readFile(resolve(root, 'src-client.tsx'), 'utf8')
    const plan = await ManifestRepairService.createPlan(resolved)
    await ManifestRepairService.applyPlan(plan)
    expect(await readFile(resolve(root, 'src-client.tsx'), 'utf8')).toBe(before)
    expect(JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))).toHaveProperty('dsh.client')
  })

  it('restores the original manifest when a reviewed plan is rolled back', async () => {
    const root = await project()
    const resolved = await resolveDshxConfig({ cwd: root })
    const packageFile = resolved.packageFile
    const before = await readFile(packageFile, 'utf8')
    const plan = await ManifestRepairService.createPlan(resolved)
    await ManifestRepairService.applyPlan(plan)
    expect(await readFile(packageFile, 'utf8')).not.toBe(before)
    await ManifestRepairService.rollbackPlan(plan)
    expect(await readFile(packageFile, 'utf8')).toBe(before)
  })
})

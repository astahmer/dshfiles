import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareBootProfile } from '../src/project/boot-profile.js'

const workspaceRoot = resolve(import.meta.dirname, '../../../../..')
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('prepareBootProfile', () => {
  it('names a stale nested install that would give Cordis a second identity', async () => {
    // The stale store must sit inside the repository to look like a pre-unification per-folder install.
    await mkdir(join(import.meta.dirname, '../.cache'), { recursive: true })
    const projectRoot = await mkdtemp(join(import.meta.dirname, '../.cache/stale-install-'))
    roots.push(projectRoot)
    await writeFile(join(projectRoot, 'package.json'), JSON.stringify({ name: '@fixture/stale', dsh: {} }))
    for (const name of ['cordis', 'cordis-plugin-include', 'cordis-plugin-loader']) {
      const stored = join(projectRoot, 'node_modules/.pnpm', `@deepseek-ai+${name}@0.0.0/node_modules/@deepseek-ai`, name)
      await mkdir(stored, { recursive: true })
      await writeFile(join(stored, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${name}`, main: 'index.js' }))
      await writeFile(join(stored, 'index.js'), '')
      await mkdir(join(projectRoot, 'node_modules/@deepseek-ai'), { recursive: true })
      await symlink(stored, join(projectRoot, 'node_modules/@deepseek-ai', name))
    }
    const dshHome = await mkdtemp(join(tmpdir(), 'dshx-stale-install-home-'))
    roots.push(dshHome)
    await mkdir(join(dshHome, 'profiles/web'), { recursive: true })
    await writeFile(join(dshHome, 'profiles/web/package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }))
    await writeFile(join(dshHome, 'profiles/web/pnpm-workspace.yaml'), '')
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = dshHome
    try {
      await expect(prepareBootProfile(projectRoot, '@fixture/stale')).rejects.toThrow(
        `stale nested install (${join(relative(workspaceRoot, projectRoot), 'node_modules')})`,
      )
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
  })
})

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { packageProject, previewPublish, testProject } from '../src/toolchain/index.js'

describe('normal plugin toolchain', () => {
  it('checks npm actual pack contents before producing the native tarball', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'dshx-pack-'))
    try {
      await mkdir(resolve(root, 'dist'))
      await writeFile(resolve(root, 'dist/index.js'), 'export function apply() {}')
      await writeFile(resolve(root, 'cordis.patch.yml'), '- insert: []')
      const manifest = { name: '@test/pack', version: '1.0.0', files: ['dist'] }
      await writeFile(resolve(root, 'package.json'), JSON.stringify(manifest))
      await expect(packageProject(root, ['dist/index.js', 'cordis.patch.yml'])).rejects.toThrow('DSHX6403')
      manifest.files.push('cordis.patch.yml')
      await writeFile(resolve(root, 'package.json'), JSON.stringify(manifest))
      const tarball = await packageProject(root, ['dist/index.js', 'cordis.patch.yml'])
      expect(tarball).toBe(resolve(root, 'test-pack-1.0.0.tgz'))
      expect((await readFile(tarball)).length).toBeGreaterThan(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('previews a registry publish without writing a tarball, and names what blocks it', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'dshx-publish-'))
    try {
      await mkdir(resolve(root, 'dist'))
      await writeFile(resolve(root, 'dist/index.js'), 'export function apply() {}')
      await writeFile(resolve(root, 'cordis.patch.yml'), '- insert: []')
      const blocked = {
        name: '@test/publish',
        version: 'next',
        private: true,
        files: ['dist', 'cordis.patch.yml'],
        dependencies: { '@test/local': 'link:../local', '@test/shared': 'workspace:*' },
      }
      await writeFile(resolve(root, 'package.json'), JSON.stringify(blocked))
      const refused = await previewPublish(root, blocked, ['dist/index.js', 'cordis.patch.yml'])
      expect(refused.diagnostics.map(item => `${item.code} ${item.severity}`)).toEqual([
        'DSHX6405 error',
        'DSHX6406 error',
        'DSHX6407 error',
        'DSHX6407 warning',
        'DSHX6408 warning',
      ])
      const ready = { name: '@test/publish', version: '0.2.0', license: 'MIT', files: ['dist', 'cordis.patch.yml'] }
      await writeFile(resolve(root, 'package.json'), JSON.stringify(ready))
      const preview = await previewPublish(root, ready, ['dist/index.js', 'cordis.patch.yml'])
      expect(preview).toMatchObject({ name: '@test/publish', version: '0.2.0', filename: 'test-publish-0.2.0.tgz', files: 3, diagnostics: [] })
      expect(await readdir(root)).not.toContain('test-publish-0.2.0.tgz')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('explains how to install the project-local test runner', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'dshx-test-'))
    try {
      await writeFile(resolve(root, 'package.json'), JSON.stringify({ name: 'missing-vitest' }))
      await expect(testProject(root)).rejects.toMatchObject({ code: 'DSHX6401', hint: expect.stringContaining('pnpm add -D vitest') })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

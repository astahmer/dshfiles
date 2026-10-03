import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { runCli } from '../src/cli/run.js'
import { parseCliArgs } from '../src/cli/args.js'
import { resolveDshxConfig } from '../src/config/resolve.js'

function streams() {
  const stdin = new PassThrough() as PassThrough & { isTTY?: boolean }
  stdin.isTTY = false
  return { stdin, stdout: new PassThrough(), stderr: new PassThrough() }
}

describe('SDK CLI workflows', () => {
  it('creates a source-fork-linked project without requiring an existing project', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'dshx-create-cli-'))
    try {
      const io = streams()
      expect(await runCli(['create', 'demo', '--template', 'basic', '--no-install', '--yes'], { io, cwd: root })).toBe(0)
      const manifest = JSON.parse(await readFile(resolve(root, 'demo/package.json'), 'utf8'))
      expect(manifest.devDependencies['@dshfiles/dshx']).toMatch(/^link:.*\/packages\/dshx\/?$/)
      expect(manifest.devDependencies['@deepseek-ai/dsh']).toBe('0.2.0-rc.2')
      expect(await readFile(resolve(root, 'demo/src/host.ts'), 'utf8')).toContain('definePlugin')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('routes tests to the project-local runner and propagates its exit code', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'dshx-test-cli-'))
    try {
      const io = streams()
      await runCli(['create', 'demo', '--template', 'basic', '--no-install', '--yes'], { io, cwd: root })
      await mkdir(resolve(root, 'demo/node_modules/@dshfiles'), { recursive: true })
      await symlink(fileURLToPath(new URL('..', import.meta.url)), resolve(root, 'demo/node_modules/@dshfiles/dshx'))
      const project = await resolveDshxConfig({ cwd: resolve(root, 'demo') })
      const testProject = vi.fn(async () => 7)
      expect(await runCli(['test', '--file', 'tests/plugin.spec.ts'], { io, runtime: { resolveConfig: async () => project, testProject } })).toBe(7)
      expect(testProject).toHaveBeenCalledWith(project.root, { stdout: io.stdout, stderr: io.stderr, file: 'tests/plugin.spec.ts' })
      expect(parseCliArgs(['package']).command).toBe('package')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

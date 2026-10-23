import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectGlobalSecretConfig } from './secret-global-config.js'

const roots: string[] = []
const scratch = async (): Promise<string> => {
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'secret-global-config-')))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('global secret config inspection', () => {
  it('names the target of a symlinked config and nothing for a plain or missing file', async () => {
    const root = await scratch()
    const target = join(root, 'managed.json')
    await writeFile(target, '{}')
    await symlink(target, join(root, 'linked.json'))
    await writeFile(join(root, 'plain.json'), '{}')
    expect(await inspectGlobalSecretConfig(join(root, 'linked.json'))).toEqual({ path: join(root, 'linked.json'), linkedTo: target })
    expect((await inspectGlobalSecretConfig(join(root, 'plain.json'))).linkedTo).toBeNull()
    expect((await inspectGlobalSecretConfig(join(root, 'missing.json'))).linkedTo).toBeNull()
  })
})

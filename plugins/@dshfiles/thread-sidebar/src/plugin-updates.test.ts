import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import { createPluginUpdateWatch } from './plugin-updates.js'

const writePackage = async (root: string, name: string): Promise<string> => {
  const directory = join(root, name)
  await mkdir(join(directory, 'dist'), { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name, exports: { '.': './dist/index.js', './client': './dist/client.js' } }))
  await writeFile(join(directory, 'dist', 'index.js'), 'export default 1')
  await writeFile(join(directory, 'dist', 'client.js'), 'export default 1')
  return directory
}

test('only Host code or manifest changes since boot need a restart, not client rebuilds or identical rebuilds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'thread-sidebar-updates-'))
  try {
    const ids = ['@x/host-change']
    const host = await writePackage(root, '@x/host-change')
    const watch = createPluginUpdateWatch({ ids: () => ids, clientPath: id => join(root, id, 'dist', 'client.js') })
    watch.remember()
    assert.deepEqual(await watch.pending(), [])

    await writeFile(join(host, 'dist', 'client.js'), 'export default 2')
    await writeFile(join(host, 'dist', 'index.js'), 'export default 1')
    assert.deepEqual(await watch.pending(), [])

    const late = await writePackage(root, '@x/late')
    ids.push('@x/late')
    await writeFile(join(host, 'dist', 'index.js'), 'export default 2')
    assert.deepEqual(await watch.pending(), ['@x/host-change'])

    await writeFile(join(late, 'cordis.patch.yml'), '- insert: []')
    assert.deepEqual(await watch.pending(), ['@x/host-change', '@x/late'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

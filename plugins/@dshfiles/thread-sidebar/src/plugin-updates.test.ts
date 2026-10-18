import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { createPluginUpdateWatch, staleClientEntries } from './plugin-updates.js'

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

test('a page reloads for the client bundles it runs at another revision, and for entries it never loaded', () => {
  const page = [
    { id: '@x/unchanged', rev: 'a1' },
    { id: '@x/rebuilt', rev: 'b1' },
    { id: '@x/removed', rev: 'c1' },
  ]
  const served = [
    { id: '@x/unchanged', rev: 'a1' },
    { id: '@x/rebuilt', rev: 'b2' },
    { id: '@x/added', rev: 'd1' },
  ]
  assert.deepEqual(staleClientEntries({ page, served }), { stale: ['@x/rebuilt'], added: ['@x/added'] })
})

test('a page that already applied a rebuild over hot reload stays out of the reload banner', () => {
  const served = [{ id: '@x/rebuilt', rev: 'b2' }]
  assert.deepEqual(staleClientEntries({ page: served, served }), { stale: [], added: [] })
})

test('an empty page revision list reports every served entry as an addition', () => {
  assert.deepEqual(staleClientEntries({ page: [], served: [{ id: '@x/one', rev: 'a1' }] }), { stale: [], added: ['@x/one'] })
})

test('a repeat check whose files kept their revision reads nothing, and a real change is still seen', async () => {
  const fs = await import('node:fs')
  const { syncBuiltinESMExports } = await import('node:module')
  const root = await mkdtemp(join(tmpdir(), 'thread-sidebar-updates-'))
  let clock = 1_000
  try {
    const ids = ['@x/steady']
    await writePackage(root, '@x/steady')
    const watch = createPluginUpdateWatch(
      { ids: () => ids, clientPath: id => join(root, id, 'dist', 'client.js') },
      { now: () => clock, rehashAfterMs: 30_000 },
    )
    watch.remember()
    assert.deepEqual(await watch.pending(), [])

    const reads = vi.spyOn(fs.default.promises, 'readFile')
    syncBuiltinESMExports()
    try {
      // The revision hints still match, so the check costs stats only.
      assert.deepEqual(await watch.pending(), [])
      expect(reads).not.toHaveBeenCalled()
    } finally {
      reads.mockRestore()
      syncBuiltinESMExports()
    }

    const afterChange = vi.spyOn(fs.default.promises, 'readFile')
    syncBuiltinESMExports()
    try {
      await writeFile(join(root, '@x/steady', 'dist', 'index.js'), 'export default 333')
      assert.deepEqual(await watch.pending(), ['@x/steady'])
      expect(afterChange.mock.calls.length).toBeGreaterThan(0)
    } finally {
      afterChange.mockRestore()
      syncBuiltinESMExports()
    }

    const afterWindow = vi.spyOn(fs.default.promises, 'readFile')
    syncBuiltinESMExports()
    try {
      clock += 60_000
      // The boot baseline still differs, so the change stays reported; past the window the bytes are hashed again.
      assert.deepEqual(await watch.pending(), ['@x/steady'])
      expect(afterWindow.mock.calls.length).toBeGreaterThan(0)
    } finally {
      afterWindow.mockRestore()
      syncBuiltinESMExports()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('concurrent checks share one scan instead of rehashing everything twice', async () => {
  const fs = await import('node:fs')
  const { syncBuiltinESMExports } = await import('node:module')
  const root = await mkdtemp(join(tmpdir(), 'thread-sidebar-updates-'))
  try {
    const ids = ['@x/one', '@x/two', '@x/three']
    for (const id of ids) await writePackage(root, id)
    const watch = createPluginUpdateWatch({ ids: () => ids, clientPath: id => join(root, id, 'dist', 'client.js') })
    watch.remember()
    assert.deepEqual(await watch.pending(), [])

    const reads = vi.spyOn(fs.default.promises, 'readFile')
    syncBuiltinESMExports()
    try {
      await writeFile(join(root, '@x/two', 'dist', 'index.js'), 'export default 2222')
      const [first, second] = await Promise.all([watch.pending(), watch.pending()])
      assert.deepEqual(first, ['@x/two'])
      assert.deepEqual(second, first)
      // One scan over three plugins reads each of its three files once, not twice.
      expect(reads.mock.calls.length).toBeLessThanOrEqual(3)
    } finally {
      reads.mockRestore()
      syncBuiltinESMExports()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

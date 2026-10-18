import { describe, expect, it } from 'vitest'
import { collectChangedFiles, indexChangedFileSelection } from './changed-file-selection.js'
import { buildFileTree } from './file-tree.js'

const files = (paths: readonly string[]) => paths.map(path => ({ path }))

describe('changed-file selection index', () => {
  it('counts the selected files under every folder instead of walking descendants per render', () => {
    const tree = buildFileTree(files(['src/app.ts', 'src/lib/a.ts', 'src/lib/b.ts', 'docs/readme.md']))
    const index = indexChangedFileSelection(tree, new Set(['src/app.ts', 'src/lib/b.ts']))
    expect(index.selectedUnder('src')).toBe(2)
    expect(index.selectedUnder('src/lib')).toBe(1)
    expect(index.selectedUnder('docs')).toBe(0)
    expect(index.selectedUnder('src/app.ts')).toBe(0)
    expect(index.selectedUnder('missing')).toBe(0)
  })

  it('ignores selected paths that are not in the tree', () => {
    const tree = buildFileTree(files(['src/app.ts']))
    const index = indexChangedFileSelection(tree, new Set(['src/app.ts', 'elsewhere/gone.ts']))
    expect(index.selectedUnder('src')).toBe(1)
  })

  it('collects a folder in tree order and stays correct on a deep 1,000-file tree', () => {
    const deep = files(Array.from({ length: 1_000 }, (_unused, position) => `level-${String(position % 50)}/f${String(position)}.ts`))
    const tree = buildFileTree(deep)
    const selected = new Set(deep.slice(0, 400).map(file => file.path))
    const index = indexChangedFileSelection(tree, selected)
    expect(index.selectedUnder('level-0')).toBeGreaterThan(0)
    const rootSelected = tree.reduce((total, node) => total + index.selectedUnder(node.path), 0)
    expect(rootSelected).toBe(400)
    const folder = tree[0]
    if (folder === undefined) throw new Error('fixture')
    expect(collectChangedFiles(folder).every(path => path.startsWith(folder.path + '/'))).toBe(true)
  })
})

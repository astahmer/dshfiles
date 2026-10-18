import type { FileTreeNode, TreeFile } from './file-tree.js'

export interface ChangedFileSelectionIndex {
  /** How many of the selected paths sit under this folder; 0 for a file path or an unknown folder. */
  selectedUnder(path: string): number
}

/**
 * One post-order pass over the changed-file tree, so a folder's tri-state checkbox reads a count instead of
 * re-walking its descendants at every ancestor level on every render.
 */
export const indexChangedFileSelection = <File extends TreeFile>(
  roots: readonly FileTreeNode<File>[],
  selected: ReadonlySet<string>,
): ChangedFileSelectionIndex => {
  const selectedUnder = new Map<string, number>()
  const walk = (nodes: readonly FileTreeNode<File>[]): number => {
    let count = 0
    for (const node of nodes) {
      if (node.file !== null) {
        if (selected.has(node.file.path)) count += 1
        continue
      }
      const subtree = walk(node.children)
      selectedUnder.set(node.path, subtree)
      count += subtree
    }
    return count
  }
  walk(roots)
  return { selectedUnder: path => selectedUnder.get(path) ?? 0 }
}

/** Paths under a folder, gathered when a select-all actually runs rather than on every render. */
export const collectChangedFiles = <File extends TreeFile>(node: FileTreeNode<File>): readonly string[] =>
  node.file !== null ? [node.file.path] : node.children.flatMap(child => collectChangedFiles(child))

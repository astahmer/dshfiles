export interface TreeFile {
  readonly path: string
}

export interface FileTreeNode<File extends TreeFile> {
  readonly name: string
  readonly path: string
  readonly file: File | null
  readonly fileCount: number
  readonly children: readonly FileTreeNode<File>[]
}

interface MutableNode<File extends TreeFile> {
  readonly name: string
  readonly path: string
  file: File | null
  readonly children: Map<string, MutableNode<File>>
}

/** Group changed files into folders; folders sort before files and carry their descendant file count. */
export const buildFileTree = <File extends TreeFile>(files: readonly File[]): FileTreeNode<File>[] => {
  const root = new Map<string, MutableNode<File>>()
  for (const file of files) {
    const parts = file.path.split('/').filter(part => part.length > 0)
    let children = root
    let currentPath = ''
    parts.forEach((part, index) => {
      currentPath = currentPath.length === 0 ? part : currentPath + '/' + part
      const leaf = index === parts.length - 1
      const key = (leaf ? 'f:' : 'd:') + part
      let node = children.get(key)
      if (node === undefined) {
        node = { name: part, path: currentPath, file: null, children: new Map() }
        children.set(key, node)
      }
      if (leaf) node.file = file
      else children = node.children
    })
  }
  const freeze = (nodes: Map<string, MutableNode<File>>): FileTreeNode<File>[] =>
    [...nodes.values()]
      .map(node => {
        const children = freeze(node.children)
        return {
          name: node.name,
          path: node.path,
          file: node.file,
          children,
          fileCount: node.file === null ? children.reduce((sum, child) => sum + child.fileCount, 0) : 1,
        }
      })
      .sort((left, right) => {
        if ((left.file === null) !== (right.file === null)) return left.file === null ? -1 : 1
        return left.name.localeCompare(right.name, undefined, { numeric: true })
      })
  return freeze(root)
}

/** Split a repository path into its file name and dimmed directory part. */
export const splitFilePath = (path: string): { readonly name: string; readonly directory: string } => {
  const index = path.lastIndexOf('/')
  return index < 0 ? { name: path, directory: '' } : { name: path.slice(index + 1), directory: path.slice(0, index) }
}

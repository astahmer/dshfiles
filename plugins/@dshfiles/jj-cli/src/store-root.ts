import { Effect, FileSystem, Path } from 'effect'

const MAX_POINTER_BYTES = 4_096

/**
 * The `.jj/repo` store a workspace root uses: the directory itself in the owning checkout, the target of that pointer
 * file in every other workspace. Undefined when the root has no store or its pointer leads to no store.
 */
export const storeRootOf = Effect.fnUntraced(function* (workspaceRoot: string) {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const marker = path.join(workspaceRoot, '.jj', 'repo')
  const info = yield* fileSystem.stat(marker).pipe(Effect.option)
  if (info._tag === 'None') return undefined
  if (info.value.type === 'Directory') return marker
  if (info.value.type !== 'File' || Number(info.value.size) > MAX_POINTER_BYTES) return undefined
  const pointer = (yield* fileSystem.readFileString(marker)).trim()
  if (pointer.length === 0) return undefined
  const store = path.resolve(path.dirname(marker), pointer)
  if (path.basename(store) !== 'repo' || path.basename(path.dirname(store)) !== '.jj') return undefined
  const storeInfo = yield* fileSystem.stat(store).pipe(Effect.option)
  if (storeInfo._tag === 'None' || storeInfo.value.type !== 'Directory') return undefined
  return store
})

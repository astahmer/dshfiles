import { watch } from 'chokidar'
import { access, realpath } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import type { DevProjectWatcher } from './types.js'

/** Watch exact project files and normalize atomic editor saves across platforms. */
export async function watchProjectFiles(files: readonly string[], onChange: (file: string) => void): Promise<DevProjectWatcher> {
  const watchedFiles = new Map<string, string>()
  const watchedDirectories = new Set<string>()
  for (const file of files) {
    const absolute = resolve(file)
    const directory = dirname(absolute)
    const available = await access(directory).then(
      () => true,
      () => false,
    )
    if (!available) continue
    const realDirectory = await realpath(directory)
    watchedFiles.set(resolve(realDirectory, basename(absolute)), absolute)
    watchedDirectories.add(realDirectory)
  }

  if (watchedFiles.size === 0) {
    return { close: async () => undefined }
  }

  const watcher = watch([...watchedDirectories], { atomic: true, depth: 0, ignoreInitial: true })
  const notify = (file: string): void => {
    const requestedFile = watchedFiles.get(resolve(file))
    if (requestedFile !== undefined) onChange(requestedFile)
  }
  const notifyAll = (): void => {
    for (const file of new Set(watchedFiles.values())) onChange(file)
  }

  watcher.on('add', notify).on('change', notify).on('unlink', notify).on('error', notifyAll)
  await new Promise<void>(resolveReady => {
    watcher.once('ready', resolveReady)
    watcher.once('error', () => resolveReady())
  })

  let closed = false
  return {
    async close() {
      if (closed) return
      closed = true
      await watcher.close()
    },
  }
}

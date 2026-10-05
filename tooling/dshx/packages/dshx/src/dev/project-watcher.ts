import { watch } from 'chokidar'
import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { DevProjectWatcher } from './types.js'

/** Watch exact project files and normalize atomic editor saves across platforms. */
export async function watchProjectFiles(files: readonly string[], onChange: (file: string) => void): Promise<DevProjectWatcher> {
  const availableFiles = new Set<string>()
  for (const file of files) {
    const absolute = resolve(file)
    const directory = dirname(absolute)
    const available = await access(directory).then(
      () => true,
      () => false,
    )
    if (available) availableFiles.add(absolute)
  }

  if (availableFiles.size === 0) {
    return { close: async () => undefined }
  }

  const targets = [...availableFiles]
  const watcher = watch(targets, { atomic: true, ignoreInitial: true })
  const notify = (file: string): void => {
    const absolute = resolve(file)
    if (availableFiles.has(absolute)) onChange(absolute)
  }
  const notifyAll = (): void => {
    for (const file of availableFiles) onChange(file)
  }

  watcher.on('add', notify).on('change', notify).on('unlink', notify).on('error', notifyAll)
  await new Promise<void>(resolveReady => {
    watcher.once('ready', resolveReady)
    watcher.once('error', resolveReady)
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

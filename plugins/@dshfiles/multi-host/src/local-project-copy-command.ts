import { posix } from 'node:path'
import { shellQuote } from './connectors/ssh.js'

export const createLocalProjectCopyCommand = (input: { readonly destinationPath: string; readonly paths: readonly string[] }): string => {
  const symlinkPaths = new Set<string>()
  for (const path of input.paths) {
    const components = path.split('/')
    for (let index = 1; index <= components.length; index += 1) {
      symlinkPaths.add(posix.join(input.destinationPath, ...components.slice(0, index)))
    }
  }
  const symlinkChecks = [...symlinkPaths].map(
    path => `if [ -L ${shellQuote(path)} ]; then printf '%s\\n' 'Refusing local file copy through a symlinked project path.' >&2; exit 73; fi`,
  )
  return [...symlinkChecks, `tar -xkf - -C ${shellQuote(input.destinationPath)}`].join('\n')
}

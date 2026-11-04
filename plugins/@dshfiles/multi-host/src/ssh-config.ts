import { homedir } from 'node:os'
import { Effect, FileSystem, Path } from 'effect'

/**
 * Names SSH already knows how to reach, offered when adding a host: concrete `Host` aliases from the OpenSSH config
 * (following `Include`) and plain host names from `known_hosts`. Wildcards and hashed entries are skipped.
 */
export const listSshConfigHosts = Effect.fn('multi-host ssh config read')(function* (sshDirectory: string) {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const aliases = new Set<string>()
  const visited = new Set<string>()
  const readText = (file: string) => fileSystem.readFileString(file).pipe(Effect.orElseSucceed(() => ''))

  const expand = Effect.fnUntraced(function* (pattern: string) {
    const absolute = pattern.startsWith('~/') ? path.join(homedir(), pattern.slice(2)) : path.isAbsolute(pattern) ? pattern : path.join(sshDirectory, pattern)
    if (!absolute.includes('*')) return [absolute]
    const directory = path.dirname(absolute)
    const matcher = new RegExp(
      `^${path
        .basename(absolute)
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')}$`,
    )
    const names = yield* fileSystem.readDirectory(directory).pipe(Effect.orElseSucceed((): string[] => []))
    return names.filter(name => matcher.test(name)).map(name => path.join(directory, name))
  })

  const visit = (file: string, depth: number): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (depth > 4 || visited.has(file) || aliases.size >= 200) return
      visited.add(file)
      const includes: string[] = []
      for (const rawLine of (yield* readText(file)).split('\n')) {
        const match = /^(Host|Include)\s+(.+)$/i.exec(rawLine.trim())
        if (match === null) continue
        const values = (match[2] ?? '').split(/\s+/).filter(Boolean)
        if (match[1]?.toLowerCase() === 'include') {
          includes.push(...values)
          continue
        }
        for (const value of values) if (!/[*?!]/.test(value)) aliases.add(value)
      }
      for (const include of includes) {
        for (const included of yield* expand(include)) yield* visit(included, depth + 1)
      }
    })

  yield* visit(path.join(sshDirectory, 'config'), 0)
  const knownHosts = new Set<string>()
  for (const line of (yield* readText(path.join(sshDirectory, 'known_hosts'))).split('\n')) {
    const field = line.split(' ', 1)[0] ?? ''
    if (field === '' || field.startsWith('|') || field.startsWith('#') || field.startsWith('@')) continue
    for (const name of field.split(',')) if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) knownHosts.add(name)
  }
  return {
    aliases: [...aliases].sort(),
    knownHosts: [...knownHosts]
      .filter(name => !aliases.has(name))
      .sort()
      .slice(0, 200),
  }
})

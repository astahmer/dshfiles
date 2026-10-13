import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'

/**
 * Names SSH already knows how to reach, offered when adding a host: concrete `Host` aliases from the OpenSSH config
 * (following `Include`) and plain host names from `known_hosts`. Wildcards and hashed entries are skipped.
 */
export const listSshConfigHosts = async (sshDirectory: string): Promise<{ aliases: string[]; knownHosts: string[] }> => {
  const aliases = new Set<string>()
  const visited = new Set<string>()
  const expand = async (pattern: string): Promise<string[]> => {
    const absolute = pattern.startsWith('~/') ? join(homedir(), pattern.slice(2)) : isAbsolute(pattern) ? pattern : join(sshDirectory, pattern)
    if (!absolute.includes('*')) return [absolute]
    const directory = dirname(absolute)
    const matcher = new RegExp(
      `^${basename(absolute)
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')}$`,
    )
    const names = await readdir(directory).catch(() => [])
    return names.filter(name => matcher.test(name)).map(name => join(directory, name))
  }
  const visit = async (path: string, depth: number): Promise<void> => {
    if (depth > 4 || visited.has(path) || aliases.size >= 200) return
    visited.add(path)
    const content = await readFile(path, 'utf8').catch(() => '')
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim()
      const match = /^(Host|Include)\s+(.+)$/i.exec(line)
      if (match === null) continue
      const values = (match[2] ?? '').split(/\s+/).filter(Boolean)
      if (match[1]?.toLowerCase() === 'include') {
        for (const value of values) for (const included of await expand(value)) await visit(included, depth + 1)
        continue
      }
      for (const value of values) if (!/[*?!]/.test(value)) aliases.add(value)
    }
  }
  await visit(join(sshDirectory, 'config'), 0)
  const knownHosts = new Set<string>()
  const known = await readFile(join(sshDirectory, 'known_hosts'), 'utf8').catch(() => '')
  for (const line of known.split('\n')) {
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
}

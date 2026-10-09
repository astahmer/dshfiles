/**
 * `.gitignore` matching for the ⌘P walk (gitignore(5)): `#` comments, `!` negation, trailing `/` for directories,
 * a slash anywhere but the end anchors to the file's directory, `*`, `?`, `[...]`, and `**` as a leading, trailing
 * or middle segment. Later rules win, deeper files after shallower ones. Not covered: `.git/info/exclude`,
 * `core.excludesFile`, and re-including a path under an excluded directory (git cannot either).
 */
export interface IgnoreRule {
  /** Directory of the `.gitignore` the rule came from, workspace-relative; `''` for the root. */
  readonly base: string
  readonly negate: boolean
  readonly directoryOnly: boolean
  readonly pattern: RegExp
}

const escapeRegExp = (character: string): string => (/[.+^${}()|\\]/.test(character) ? `\\${character}` : character)

const segmentToRegExp = (segment: string): string => {
  let source = ''
  for (let index = 0; index < segment.length; index++) {
    const character = segment[index] ?? ''
    if (character === '*') source += '[^/]*'
    else if (character === '?') source += '[^/]'
    else if (character === '\\' && index + 1 < segment.length) source += escapeRegExp(segment[++index] ?? '')
    else if (character === '[' && segment.indexOf(']', index + 2) !== -1) {
      const close = segment.indexOf(']', index + 2)
      source += `[${segment
        .slice(index + 1, close)
        .replace(/^!/, '^')
        .replace(/\\/g, '\\\\')}]`
      index = close
    } else source += escapeRegExp(character)
  }
  return source
}

const globToRegExp = (glob: string, anchored: boolean): RegExp => {
  const segments = glob.split('/')
  let source = anchored ? '' : '(?:.*/)?'
  let joinWithSlash = false
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1
    if (segment === '**') {
      if (last) source += index === 0 ? '.*' : '/.*'
      else source += index === 0 ? '(?:.*/)?' : '/(?:.*/)?'
      joinWithSlash = false
      return
    }
    source += (joinWithSlash ? '/' : '') + segmentToRegExp(segment)
    joinWithSlash = true
  })
  return new RegExp(`^${source}$`)
}

export const parseGitignore = (options: { readonly text: string; readonly base: string }): readonly IgnoreRule[] => {
  const rules: IgnoreRule[] = []
  for (const rawLine of options.text.split(/\r?\n/)) {
    let line = rawLine.replace(/(?<!\\)\s+$/, '')
    if (line === '' || line.startsWith('#')) continue
    const negate = line.startsWith('!')
    if (negate) line = line.slice(1)
    else if (line.startsWith('\\!') || line.startsWith('\\#')) line = line.slice(1)
    const directoryOnly = line.endsWith('/')
    if (directoryOnly) line = line.replace(/\/+$/, '')
    if (line === '') continue
    const anchored = line.includes('/')
    if (line.startsWith('/')) line = line.slice(1)
    rules.push({ base: options.base, negate, directoryOnly, pattern: globToRegExp(line, anchored) })
  }
  return rules
}

/** `rules` in file order, root `.gitignore` first; `path` is workspace-relative. */
export const isIgnored = (options: { readonly rules: readonly IgnoreRule[]; readonly path: string; readonly directory: boolean }): boolean => {
  let ignored = false
  for (const rule of options.rules) {
    if (rule.directoryOnly && !options.directory) continue
    if (rule.base !== '' && !options.path.startsWith(rule.base + '/')) continue
    const relative = rule.base === '' ? options.path : options.path.slice(rule.base.length + 1)
    if (rule.pattern.test(relative)) ignored = !rule.negate
  }
  return ignored
}

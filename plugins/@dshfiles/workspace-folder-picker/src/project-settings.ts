import type { ProjectConfig } from './project-config.js'

export type ProjectSettingKey = 'iconPath' | 'defaultThreadWorkspace' | 'bookmark' | 'checks' | 'scripts'

/** Which layer decides a declared project setting: the repository file, the profile, or the plugin's own default. */
export type ProjectSettingTier = 'file' | 'profile' | 'built-in'

export interface ProjectSettingRow {
  readonly key: ProjectSettingKey
  readonly label: string
  /** The value the file declares, formatted for display; null when it declares nothing for this key. */
  readonly declared: string | null
  readonly tier: ProjectSettingTier
  readonly tierLabel: string
  /** What applies instead while the file declares nothing. */
  readonly fallback: string
}

interface SettingDefinition {
  readonly key: ProjectSettingKey
  readonly label: string
  readonly tierWhenAbsent: Exclude<ProjectSettingTier, 'file'>
  readonly fallback: string
  readonly format: (config: ProjectConfig) => string | null
}

const definitions: readonly SettingDefinition[] = [
  {
    key: 'iconPath',
    label: 'Icon path',
    tierWhenAbsent: 'built-in',
    fallback: 'Auto-detected icon, else a monogram',
    format: config => config.iconPath ?? null,
  },
  {
    key: 'defaultThreadWorkspace',
    label: 'New threads',
    tierWhenAbsent: 'profile',
    fallback: 'The profile setting',
    format: config => config.defaultThreadWorkspace ?? null,
  },
  {
    key: 'bookmark',
    label: 'Bookmark',
    tierWhenAbsent: 'profile',
    fallback: 'The profile setting',
    format: config => config.bookmark ?? null,
  },
  {
    key: 'checks',
    label: 'Trusted checks',
    tierWhenAbsent: 'built-in',
    fallback: 'No checks offered',
    format: config => (config.checks === undefined || config.checks.length === 0 ? null : config.checks.join(', ')),
  },
  {
    key: 'scripts',
    label: 'Suggested scripts',
    tierWhenAbsent: 'built-in',
    fallback: 'No scripts suggested',
    format: config => (config.scripts === undefined || config.scripts.length === 0 ? null : config.scripts.map(script => script.name).join(', ')),
  },
]

const tierLabels = {
  file: 'dsh.project.json',
  profile: 'Profile setting',
  'built-in': 'Built-in',
} satisfies Record<ProjectSettingTier, string>

/** One row per declared key, naming the tier that actually wins so the section never implies a project override store. */
export const projectSettingRows = (config: ProjectConfig | null): readonly ProjectSettingRow[] =>
  definitions.map(definition => {
    const declared = config === null ? null : definition.format(config)
    const tier: ProjectSettingTier = declared === null ? definition.tierWhenAbsent : 'file'
    return {
      key: definition.key,
      label: definition.label,
      declared,
      tier,
      tierLabel: tierLabels[tier],
      fallback: definition.fallback,
    }
  })

export interface SuggestedScriptSnippet {
  readonly name: string
  readonly yaml: string
  /** Why this script cannot be copied yet; null when its YAML is ready. */
  readonly problem: string | null
}

const splitCommandLine = (line: string): readonly string[] | null => {
  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let started = false
  for (const character of line) {
    if (quote !== null) {
      if (character === quote) {
        quote = null
        continue
      }
      current += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      started = true
      continue
    }
    if (/\s/u.test(character)) {
      if (started) parts.push(current)
      current = ''
      started = false
      continue
    }
    current += character
    started = true
  }
  if (quote !== null) return null
  if (started) parts.push(current)
  return parts
}

/** project-checks ids are `[a-z0-9][a-z0-9-]{0,31}`, so a script name becomes a stable slug of that shape. */
const actionId = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .slice(0, 32)
    .replace(/^-+|-+$/gu, '')
  return slug === '' ? 'script' : slug
}

const yamlString = (value: string): string => JSON.stringify(value)

/**
 * The profile-trusted `project-checks` action for one suggested script, as YAML an operator pastes into the
 * `actions:` list. The command line is split into argv here because the profile entry never evaluates shell text.
 */
export const projectCheckSnippet = (input: {
  readonly root: string
  readonly script: { readonly name: string; readonly command: string; readonly hint?: string | undefined }
}): SuggestedScriptSnippet => {
  const parts = splitCommandLine(input.script.command)
  const [command, ...args] = parts ?? []
  if (parts === null) {
    return {
      name: input.script.name,
      yaml: '',
      problem: 'This command line has an unclosed quote, so it cannot be split into an executable and its arguments.',
    }
  }
  if (command === undefined || command === '') {
    return { name: input.script.name, yaml: '', problem: 'This command line is empty, so there is nothing to import.' }
  }
  const lines = [
    `  - id: ${yamlString(actionId(input.script.name))}`,
    `    label: ${yamlString(input.script.name.slice(0, 80))}`,
    ...(input.script.hint === undefined ? [] : [`    description: ${yamlString(input.script.hint.slice(0, 240))}`]),
    `    command: ${yamlString(command)}`,
    `    args: [${args.map(yamlString).join(', ')}]`,
    `    root: ${yamlString(input.root)}`,
  ]
  return { name: input.script.name, yaml: `${lines.join('\n')}\n`, problem: null }
}

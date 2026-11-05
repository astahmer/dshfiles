import type { BacklogKind, BacklogPriority } from './item.js'

/** A named starting point for a capture: what it prefixes, sets and adds. */
export interface BacklogTemplate {
  readonly name: string
  readonly titlePrefix: string
  readonly kind: BacklogKind
  readonly priority: BacklogPriority
  readonly tags: readonly string[]
  readonly body: string
  readonly criteria: readonly string[]
}

const defaults: readonly BacklogTemplate[] = [
  {
    name: 'Bug report',
    titlePrefix: '',
    kind: 'bug',
    priority: 'none',
    tags: ['bug'],
    body: '## Steps to reproduce\n1. \n\n## Expected\n\n## Actual\n',
    criteria: ['Reproduced', 'Root cause named', 'Regression test added'],
  },
  {
    name: 'Feature spec',
    titlePrefix: '',
    kind: 'task',
    priority: 'none',
    tags: [],
    body: '## Why\n\n## What\n\n## Out of scope\n',
    criteria: ['Behaviour described in the README', 'Covered by an end-to-end journey', 'Agent tool for every user action'],
  },
  {
    name: 'Research question',
    titlePrefix: '',
    kind: 'question',
    priority: 'none',
    tags: ['research'],
    body: '## Question\n\n## What would answer it\n',
    criteria: ['Sources cited', 'Recommendation written'],
  },
]

/** A template by name, ignoring case and surrounding space. */
const find = (templates: readonly BacklogTemplate[], name: string): BacklogTemplate | undefined => {
  const wanted = name.trim().toLowerCase()
  return templates.find(template => template.name.trim().toLowerCase() === wanted)
}

/**
 * A `/template <name>` command written in a capture: the template it names (the longest name that matches, so a name
 * may contain spaces) and the text without the command. Null when the text has no command or names no template.
 */
const extract = (text: string, templates: readonly BacklogTemplate[]): { readonly template: BacklogTemplate; readonly text: string } | null => {
  const match = /(^|\s)\/template\s+([^\n]+)/i.exec(text)
  if (match === null) return null
  const rest = match[2] ?? ''
  const named = [...templates]
    .sort((left, right) => right.name.length - left.name.length)
    .find(template => rest.toLowerCase().startsWith(template.name.toLowerCase()))
  if (named === undefined) return null
  const start = match.index + (match[1] ?? '').length
  const end = start + match[0].length - (match[1] ?? '').length - rest.length + named.name.length
  const remaining = `${text.slice(0, start)}${text.slice(end)}`.replace(/[ \t]{2,}/g, ' ').trim()
  return { template: named, text: remaining }
}

export class BacklogTemplates {
  static readonly defaults = defaults
  static readonly find = find
  static readonly extract = extract
}

import { createRuleBasedAdapter, type RuleKey } from '@pulls.review/core/analyze'
import { createPasteSource } from '@pulls.review/core/paste'
import { scopeKeySchema, type ReviewFile, type ReviewScope } from './api.js'

/** pulls.review's own rule-based copy, so a scope reads the same here and on the site. */
export const RULE_TEXTS = {
  docs: { label: 'Docs', summary: 'Documentation updates.' },
  code: { label: 'Code', summary: 'Source changes.' },
  tests: { label: 'Tests', summary: 'Test coverage for the change.' },
  config: { label: 'Config', summary: 'Configuration changes.' },
  deps: { label: 'Dependencies', summary: 'Dependency version changes.' },
  generated: { label: 'Generated', summary: 'Generated or build output changes.' },
  other: { label: 'Other', summary: "Other changes that don't fit an existing category." },
} satisfies Record<RuleKey, { readonly label: string; readonly summary: string }>

export interface GroupedPatch {
  readonly fileCount: number
  readonly additions: number
  readonly deletions: number
  readonly files: readonly ReviewFile[]
  readonly scopes: readonly ReviewScope[]
}

/**
 * Group one git patch with `@pulls.review/core`'s deterministic rule-based
 * adapter: no model call, no token, and the same rules the site uses.
 */
export const groupPatch = async (input: { readonly patch: string; readonly title: string }): Promise<GroupedPatch> => {
  const source = createPasteSource(input.patch, input.title)
  const payload = await source.fetch()
  const adapter = createRuleBasedAdapter(key => RULE_TEXTS[key])
  const grouped = await adapter.analyze(payload)
  const byPath = new Map(payload.files.map(file => [file.path, file]))
  const scopes = grouped.groups.map(group => {
    const key = scopeKeySchema.safeParse(group.key)
    const filePaths = [...group.filePaths]
    let additions = 0
    let deletions = 0
    for (const path of filePaths) {
      const file = byPath.get(path)
      additions += file?.additions ?? 0
      deletions += file?.deletions ?? 0
    }
    const fallback = RULE_TEXTS[key.success ? key.data : 'other']
    return {
      key: key.success ? key.data : 'other',
      category: group.category ?? 'other',
      label: group.label ?? fallback.label,
      summary: group.summary ?? fallback.summary,
      filePaths,
      additions,
      deletions,
    }
  })
  return {
    fileCount: payload.files.length,
    additions: payload.files.reduce((total, file) => total + file.additions, 0),
    deletions: payload.files.reduce((total, file) => total + file.deletions, 0),
    files: payload.files.map(file => ({ path: file.path, status: file.status, additions: file.additions, deletions: file.deletions })),
    scopes,
  }
}

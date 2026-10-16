import type { SkillEntry } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ClientSessionContext, InputTriggerCandidate, InputTriggerSource } from '@dshfiles/input-trigger/client'
import type { rankByName } from '@deepseek-ai/dsh-client-ui-primitives'
import { z } from 'zod'

const skillNameSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
type SkillSessionId = ClientSessionContext['sessionId']

// The @ scopes shared with @dshfiles/mentions: `@t:`/`@thread:`, `@f:`/`@file:`, `@skill:` and `@mcp:`.
const MENTION_SCOPE = /^(thread|t|file|f|skill|mcp):/iu

/** The query this source ranks: the text after its own scope prefix, or undefined while another scope is typed. */
const scopedMentionQuery = (query: string, ownScope: 'skill' | 'mcp'): string | undefined => {
  const scope = MENTION_SCOPE.exec(query)?.[1]
  if (scope === undefined) return query
  return scope.toLowerCase() === ownScope ? query.slice(scope.length + 1) : undefined
}

type SkillCatalogEntry = {
  readonly abort: AbortController
  readonly promise: Promise<readonly SkillEntry[]>
}

type SkillMentionSourceOptions = {
  readonly isSubagent: (sessionId: SkillSessionId) => boolean
  readonly list: (sessionId: SkillSessionId, signal: AbortSignal) => Promise<readonly SkillEntry[]>
  readonly rank: typeof rankByName
  readonly section: string
  readonly userOnlyLabel: string
}

const skillMentionCandidates = (input: {
  readonly skills: readonly SkillEntry[]
  readonly section: string
  readonly userOnlyLabel: string
}): readonly InputTriggerCandidate[] =>
  input.skills.map(skill => ({
    name: skill.name,
    description: skill.modelInvocable ? skill.description : `${input.userOnlyLabel} · ${skill.description}`,
    section: input.section,
  }))

const skillMentionPick = (candidate: Pick<InputTriggerCandidate, 'name'>): { readonly text: string } | undefined => {
  const parsedName = skillNameSchema.safeParse(candidate.name)
  if (!parsedName.success) return undefined
  return { text: `/${parsedName.data} ` }
}

export class SkillMentionModel {
  static readonly scopedMentionQuery = scopedMentionQuery
  static readonly skillMentionCandidates = skillMentionCandidates
  static readonly skillMentionPick = skillMentionPick
}

export const createSkillMentionSource = (options: SkillMentionSourceOptions) => {
  const catalogs = new Map<SkillSessionId, SkillCatalogEntry>()
  const fetchCatalog = (sessionId: SkillSessionId): SkillCatalogEntry => {
    const existing = catalogs.get(sessionId)
    if (existing !== undefined) return existing

    const abort = new AbortController()
    const entry: SkillCatalogEntry = { abort, promise: options.list(sessionId, abort.signal) }
    catalogs.set(sessionId, entry)
    entry.promise.catch(() => {
      if (catalogs.get(sessionId) === entry) catalogs.delete(sessionId)
    })
    return entry
  }
  const invalidate = (sessionId: SkillSessionId): void => {
    const entry = catalogs.get(sessionId)
    if (entry === undefined) return
    catalogs.delete(sessionId)
    entry.abort.abort()
  }
  const clear = (): void => {
    for (const sessionId of catalogs.keys()) invalidate(sessionId)
  }

  const source: InputTriggerSource = {
    trigger: '@',
    name: 'thread-sidebar-skills',
    order: -10,
    showGroupTitle: false,
    async candidates(session, request) {
      const query = SkillMentionModel.scopedMentionQuery(request.query, 'skill')
      if (query === undefined || request.quoted === true || options.isSubagent(session.sessionId)) return []
      try {
        const skills = await fetchCatalog(session.sessionId).promise
        if (request.signal.aborted) return []
        return SkillMentionModel.skillMentionCandidates({
          skills: options.rank(skills, query),
          section: options.section,
          userOnlyLabel: options.userOnlyLabel,
        })
      } catch {
        return []
      }
    },
    warm(session) {
      if (options.isSubagent(session.sessionId)) return
      fetchCatalog(session.sessionId).promise.catch(() => undefined)
    },
    onPick({ candidate }) {
      return SkillMentionModel.skillMentionPick(candidate)
    },
  }

  return { source, invalidate, clear }
}

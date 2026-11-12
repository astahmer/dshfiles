/** Durable per-session state for the user-controlled model-selection opt-in. */

import { z as zod } from 'zod'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { assertAllowedModelRoutes, modelRouteKey, type AllowedModelRoute } from './model-selection.ts'
import type { SubagentModelSelectionConfig } from './model-selection-settings.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records this Session’s authorized child provider/model routes. Appended
     * before the first model request; absence restricts explicit selection
     * to the current parent route. Log-only: it carries
     * no `surfaceOp` and never enters model history.
     */
    'subagent/model-selection-policy': {
      /** Exact routes this Session may select explicitly for a child. */
      allowedModels: AllowedModelRoute[]
    }
  }
}

const modelSelectionPolicySchema: zod.ZodType<AllowedModelRoute[] | null> = zod.array(zod.object({
  provider: zod.string().min(1),
  model: zod.string().min(1),
}).strict()).min(1).nullable()

/**
 * Host-only projection of the durable model-selection policy.
 * Each independently mounted consumer registers this shared definition; the registry reference-counts it.
 */
export const subagentModelSelectionProjectionDefinition = {
  key: 'subagentModelSelectionPolicy',
  stateVersion: 1,
  stateSchema: modelSelectionPolicySchema,
  init: () => null,
  apply: (policy, event) => {
    if (policy !== null || event.type !== 'subagent/model-selection-policy') return policy
    const { allowedModels } = event.data
    assertAllowedModelRoutes(allowedModels)
    if (allowedModels.length === 0) {
      throw new Error('subagent/model-selection-policy requires at least one route')
    }
    return allowedModels
  },
} satisfies ProjectionDefinition<'subagentModelSelectionPolicy', AllowedModelRoute[] | null>

/**
 * dshfiles delta: Host-only projection over the same events that keeps the latest
 * policy, so a followed replacement wins. It has its own key because the shared
 * `subagentModelSelectionPolicy` unit is registered first by the native settings
 * row, and the registry shares the first definition of a key.
 */
export const followedSubagentModelSelectionProjectionDefinition = {
  key: 'dshfilesSubagentModelSelectionPolicy',
  stateVersion: 1,
  stateSchema: modelSelectionPolicySchema,
  init: () => null,
  apply: (policy, event) => {
    if (event.type !== 'subagent/model-selection-policy') return policy
    const { allowedModels } = event.data
    assertAllowedModelRoutes(allowedModels)
    if (allowedModels.length === 0) {
      throw new Error('subagent/model-selection-policy requires at least one route')
    }
    return allowedModels
  },
} satisfies ProjectionDefinition<'dshfilesSubagentModelSelectionPolicy', AllowedModelRoute[] | null>

/**
 * Read the exact route list authorized for a Session.
 * @param subagentModelSelectionProjectionHandle - registered policy state reader.
 * @param session - session whose durable decision is read.
 * @returns a detached route list, or undefined to restrict selection to the parent route.
 */
export function subagentModelSelectionPolicy(
  subagentModelSelectionProjectionHandle: Pick<ProjectionHandle<AllowedModelRoute[] | null>, 'stateOf'>,
  session: Session,
): AllowedModelRoute[] | undefined {
  return subagentModelSelectionProjectionHandle.stateOf(session)?.map(route => ({ ...route }))
}

const sameRoutes = (left: readonly AllowedModelRoute[], right: readonly AllowedModelRoute[]): boolean =>
  left.length === right.length && left.every((route, index) => {
    const other = right[index]
    return other !== undefined && modelRouteKey(route) === modelRouteKey(other)
  })

/**
 * dshfiles delta: wrap the policy reader so each read first appends a replacement
 * policy when the enabled setting's route list no longer matches the Session's
 * recorded one. A Session that recorded no policy, or a disabled setting, keeps
 * what it has, because the tool schema is fixed when it is installed.
 * @param policy - registered policy state reader.
 * @param currentSettings - reads the live selection service on each use, since a settings edit may replace it; absent means nothing to follow.
 * @returns a reader with the same contract that follows the setting.
 */
export function followingSubagentModelSelection(
  policy: ProjectionHandle<AllowedModelRoute[] | null>,
  currentSettings: () => SubagentModelSelectionConfig | undefined,
): ProjectionHandle<AllowedModelRoute[] | null> {
  const follow = (session: Session): void => {
    const settings = currentSettings()
    if (settings === undefined) return
    const recorded = policy.stateOf(session)
    if (recorded === null) return
    // The native settings service keeps its reader private; this fork reads the same value it samples.
    const current = settings['current']()
    if (!current.enabled || current.allowedModels.length === 0 || sameRoutes(recorded, current.allowedModels)) return
    session.append('subagent/model-selection-policy', { allowedModels: current.allowedModels })
  }
  const following: ProjectionHandle<AllowedModelRoute[] | null> = {
    stateOf: (session) => {
      follow(session)
      return policy.stateOf(session)
    },
    readerFor: session => () => following.stateOf(session),
    dispose: () => policy.dispose(),
  }
  return following
}

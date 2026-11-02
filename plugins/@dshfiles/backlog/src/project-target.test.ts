import { describe, expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'

import { BacklogProjectTarget, type BacklogProjectTargetPorts } from './project-target.js'

const targets = (input: {
  readonly workspaces?: readonly { readonly id: string; readonly path: string }[]
  readonly projects?: Readonly<Record<string, string | null>>
}): BacklogProjectTargetPorts => ({
  workspaceAt: path => Effect.succeed(Option.fromUndefinedOr(input.workspaces?.find(workspace => workspace.path === path))),
  projectOf: workspaceId => Effect.succeed(Option.map(Option.fromNullishOr(input.projects?.[workspaceId]), path => ({ path }))),
})

describe('capture project target', () => {
  it.effect('files a workspace cut from a project under the project, whatever the folder is called', () =>
    Effect.gen(function* () {
      const ports = targets({
        workspaces: [
          { id: 'w-thread', path: '/custom/threads/dshfiles/thread-1b7a8c' },
          { id: 'w-project', path: '/work/dshfiles' },
        ],
        projects: { 'w-thread': '/work/dshfiles' },
      })
      expect(yield* BacklogProjectTarget.of('/custom/threads/dshfiles/thread-1b7a8c', ports)).toBe('/work/dshfiles')
    }),
  )

  it.effect('keeps a registered project and a folder no workspace claims as they are', () =>
    Effect.gen(function* () {
      const ports = targets({ workspaces: [{ id: 'w-project', path: '/work/dshfiles' }], projects: { 'w-project': null } })
      expect(yield* BacklogProjectTarget.of('/work/dshfiles', ports)).toBe('/work/dshfiles')
      expect(yield* BacklogProjectTarget.of('/work/unregistered', ports)).toBe('/work/unregistered')
    }),
  )

  it.effect('keeps the workspace when jj cannot say which project it came from', () =>
    Effect.gen(function* () {
      const ports = targets({ workspaces: [{ id: 'w-thread', path: '/work/dshfiles-threads/thread-1b7a8c' }] })
      expect(yield* BacklogProjectTarget.of('/work/dshfiles-threads/thread-1b7a8c', ports)).toBe('/work/dshfiles-threads/thread-1b7a8c')
    }),
  )
})

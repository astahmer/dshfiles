import { describe, expect, test } from 'vitest'
import { jjRepositoriesSchema, jjRepositorySchema, jjRevisionSchema, jjThreadSchema } from '../src/api.js'

describe('legacy Jujutsu schema exports', () => {
  test('remain composable Zod schemas for plugin consumers', () => {
    const revision = { changeId: 'change', commitId: 'commit', description: 'description', conflict: false }
    const thread = {
      name: 'thread',
      path: '/work/project',
      workspaceId: 'workspace',
      sessionIds: [],
      finished: false,
      missing: false,
      behind: false,
      unlanded: [revision],
    }
    const repository = { repoRoot: '/work/project', title: 'project', workspaceId: null, threads: [thread] }
    const repositories = { repositories: [repository] }

    expect(jjRevisionSchema.array().parse([revision])).toEqual([revision])
    expect(jjThreadSchema.optional().parse(undefined)).toBeUndefined()
    expect(jjRepositorySchema.parse(repository)).toEqual({ ...repository, bookmarks: [] })
    expect(jjRepositoriesSchema.optional().parse(repositories)).toEqual({ repositories: [{ ...repository, bookmarks: [] }] })
  })
})

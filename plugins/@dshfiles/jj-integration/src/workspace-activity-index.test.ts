import { describe, expect, it } from 'vitest'
import { WorkspaceActivityIndex } from './workspace-activity-index.js'

const question = { userQuestions: { active: ['which?'] } }
const noQuestion = { userQuestions: { active: [] } }

const largeList = (count: number) => {
  const byId: Record<string, { running: boolean; cwd: string; projectionValues: typeof noQuestion }> = {}
  for (let index = 0; index < count; index += 1) byId[`s${index}`] = { running: false, cwd: `/w/${index}`, projectionValues: noQuestion }
  return byId
}

describe('workspace activity index', () => {
  it('folds a Session-list snapshot once however many conversations read it', () => {
    const byId = largeList(2_000)
    let enumerations = 0
    const counted = new Proxy(byId, {
      ownKeys: target => {
        enumerations += 1
        return Reflect.ownKeys(target)
      },
    })
    for (let view = 0; view < 3; view += 1) {
      WorkspaceActivityIndex.isRunning({ byId: counted, sessionIds: [`s${view}`], path: `/w/${view}` })
      WorkspaceActivityIndex.hasQuestion({ byId: counted, sessionIds: [`s${view}`], path: `/w/${view}` })
    }
    expect(enumerations).toBe(1)
    expect(WorkspaceActivityIndex.byCwd(counted)).toBe(WorkspaceActivityIndex.byCwd(counted))
  })

  it('rebuilds for the next snapshot so a new run is seen', () => {
    const before = largeList(3)
    expect(WorkspaceActivityIndex.isRunning({ byId: before, sessionIds: [], path: '/w/1' })).toBe(false)
    const after = { ...before, s9: { running: true, cwd: '/w/1', projectionValues: noQuestion } }
    expect(WorkspaceActivityIndex.isRunning({ byId: after, sessionIds: [], path: '/w/1' })).toBe(true)
  })

  it('counts a thread Session that runs elsewhere and a sibling in the same folder', () => {
    const byId = {
      own: { running: true, cwd: '/moved', projectionValues: noQuestion },
      sibling: { running: false, cwd: '/w', projectionValues: question },
      other: { running: true, cwd: '/other', projectionValues: question },
    }
    expect(WorkspaceActivityIndex.isRunning({ byId, sessionIds: ['own'], path: '/w' })).toBe(true)
    expect(WorkspaceActivityIndex.isRunning({ byId, sessionIds: ['sibling'], path: '/w' })).toBe(false)
    expect(WorkspaceActivityIndex.hasQuestion({ byId, sessionIds: [], path: '/w' })).toBe(true)
    expect(WorkspaceActivityIndex.hasQuestion({ byId, sessionIds: ['own'], path: undefined })).toBe(false)
    expect(WorkspaceActivityIndex.hasQuestion({ byId, sessionIds: ['other'], path: undefined })).toBe(true)
  })
})

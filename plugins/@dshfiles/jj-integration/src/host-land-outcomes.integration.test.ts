import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JjIntegrationTestHost, type ActivityEvent, type JjIntegrationTestHarness } from './host-test-harness.js'

const jj = JjIntegrationTestHost.jj

/**
 * Characterization that pins the Host half's behaviour through the Effect-native edge (formerly recorded in the migration plan, jj-int h):
 * every land outcome, reached through the manual `land` API and through Project Checks' verified-turn event, with
 * the activity events it emits and the exact text it asks the thread's agent to act on.
 */

const jjAvailable = spawnSync('jj', ['--version']).status === 0

const normalize = (text: string, root: string): string =>
  text
    .replaceAll(root, '<root>')
    .replace(/thread-[0-9a-f]{6}/g, '<thread>')
    .replace(/\b[k-z]{12,32}\b/g, '<change>')
    .replace(/\b[0-9a-f]{12,40}\b/g, '<commit>')

describe.skipIf(!jjAvailable)('jj-integration land outcomes', () => {
  let root: string
  let harness: JjIntegrationTestHarness
  let repoCount = 0

  const freshRepository = (): string => {
    repoCount += 1
    const repo = join(root, `repo-${String(repoCount)}`)
    JjIntegrationTestHost.initRepository(repo)
    return repo
  }

  const advanceMain = (repo: string, content: string): void => {
    writeFileSync(join(repo, 'shared.txt'), content)
    jj(repo, 'describe', '-m', 'feat: target change')
    jj(repo, 'bookmark', 'set', 'main', '-r', '@')
    jj(repo, 'new')
  }

  const eventsSince = (start: number): readonly Pick<ActivityEvent, 'type' | 'level' | 'summary' | 'detail'>[] =>
    harness.events.slice(start).map(event => ({
      type: event.type,
      level: event.level,
      summary: normalize(event.summary, root),
      detail: event.detail === null ? null : normalize(event.detail, root),
    }))

  beforeAll(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'jj-land-outcomes-')))
    harness = await JjIntegrationTestHost.start({ settings: { syncWorkspaceAfterLand: '', autoIntegrationScope: 'isolated' } })
  })

  afterAll(async () => {
    await harness?.dispose()
    for (let index = 1; index <= repoCount; index += 1) rmSync(join(root, `repo-${String(index)}-threads`), { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  })

  describe('manual land', () => {
    const landManually = async (prepare: (repo: string, sessionId: string) => Promise<string>) => {
      const sessionId = `session-manual-${String(repoCount + 1)}`
      harness.setSession(sessionId, { running: false, questions: 0 })
      const repo = freshRepository()
      const path = await prepare(repo, sessionId)
      const eventStart = harness.events.length
      const promptStart = harness.prompts.length
      const output = await harness.api.land({ path, sessionId })
      return {
        status: output.status,
        agentAsked: output.agentAsked,
        files: output.files,
        revisions: output.revisions.length,
        events: eventsSince(eventStart),
        prompts: harness.prompts.slice(promptStart).map(prompt => ({ toLander: prompt.sessionId === sessionId, text: normalize(prompt.text, root) })),
      }
    }

    it('landed', async () => {
      expect(await landManually((repo, sessionId) => harness.provisionThread(repo, { sessionIds: [sessionId] }))).toMatchInlineSnapshot(`
        {
          "agentAsked": false,
          "events": [
            {
              "detail": null,
              "level": "notable",
              "summary": "Rebased 1 revision(s) from <thread> onto main",
              "type": "workspace.rebase_landed",
            },
          ],
          "files": [],
          "prompts": [],
          "revisions": 1,
          "status": "landed",
        }
      `)
    })

    it('nothing-to-land', async () => {
      expect(
        await landManually(async (repo, sessionId) => {
          const path = await harness.provisionThread(repo, { sessionIds: [sessionId] })
          jj(path, 'abandon', '@')
          return path
        }),
      ).toMatchInlineSnapshot(`
        {
          "agentAsked": false,
          "events": [
            {
              "detail": null,
              "level": "notable",
              "summary": "Rebase nothing-to-land in <thread>",
              "type": "workspace.rebase_nothing_to_land",
            },
          ],
          "files": [],
          "prompts": [],
          "revisions": 0,
          "status": "nothing-to-land",
        }
      `)
    })

    it('needs-description', async () => {
      expect(
        await landManually(async (repo, sessionId) => {
          const path = await harness.provisionThread(repo, { sessionIds: [sessionId] })
          jj(path, 'describe', '-m', '')
          return path
        }),
      ).toMatchInlineSnapshot(`
        {
          "agentAsked": true,
          "events": [
            {
              "detail": null,
              "level": "attention",
              "summary": "Rebase needs-description in <thread>",
              "type": "workspace.rebase_needs_description",
            },
          ],
          "files": [],
          "prompts": [
            {
              "text": "Rebasing this thread onto \`main\` stopped because these revisions have no real description:
        - <change>
        Describe each one with \`jj describe -r <change-id> -m "<conventional commit message>"\` (split unrelated changes with \`jj split\` first), then call the \`jj_thread_rebase\` tool again.",
              "toLander": true,
            },
          ],
          "revisions": 1,
          "status": "needs-description",
        }
      `)
    })

    it('conflicted', async () => {
      expect(
        await landManually(async (repo, sessionId) => {
          const path = await harness.provisionThread(repo, { sessionIds: [sessionId], file: 'shared.txt' })
          advanceMain(repo, 'main side\n')
          return path
        }),
      ).toMatchInlineSnapshot(`
        {
          "agentAsked": true,
          "events": [
            {
              "detail": null,
              "level": "attention",
              "summary": "Rebase conflicted in <thread>",
              "type": "workspace.rebase_conflicted",
            },
          ],
          "files": [
            "shared.txt",
          ],
          "prompts": [
            {
              "text": "Rebasing this thread onto \`main\` stopped with conflicts in:
        - shared.txt
        Resolve them in this workspace (edit the files so no conflict markers remain; the conflicted revisions are already rebased), keep every revision described, then call the \`jj_thread_rebase\` tool again.",
              "toLander": true,
            },
          ],
          "revisions": 1,
          "status": "conflicted",
        }
      `)
    })
  })

  describe('automatic integration after verified checks', () => {
    const integrateAutomatically = async (input: {
      readonly prepare: (repo: string, sessionId: string) => Promise<string>
      readonly verdict?: Parameters<JjIntegrationTestHarness['setCandidateVerdict']>[0]
      readonly staleSource?: boolean
    }) => {
      const sessionId = `session-auto-${String(repoCount + 1)}`
      harness.setSession(sessionId, { running: false, questions: 0 })
      harness.setCandidateVerdict(input.verdict ?? { status: 'passed', prompt: null })
      const repo = freshRepository()
      const path = await input.prepare(repo, sessionId)
      const eventStart = harness.events.length
      const agentFixes = await harness.verifyTurn(
        input.staleSource === true ? { sessionId, path, turn: 3, sourceRevision: '0'.repeat(40) } : { sessionId, path, turn: 3 },
      )
      return { events: eventsSince(eventStart), agentFixes: agentFixes.map(text => normalize(text, root)) }
    }
    const describedThread = (repo: string, sessionId: string) => harness.provisionThread(repo, { sessionIds: [sessionId] })

    it('landed', async () => {
      expect(await integrateAutomatically({ prepare: describedThread })).toMatchInlineSnapshot(`
        {
          "agentFixes": [],
          "events": [
            {
              "detail": "Turn 3",
              "level": "notable",
              "summary": "Queued automatic integration for <thread>",
              "type": "workspace.auto_integration_queued",
            },
            {
              "detail": "Turn 3",
              "level": "notable",
              "summary": "Automatically rebased 1 revision(s) onto main.",
              "type": "workspace.auto_integration_landed",
            },
          ],
        }
      `)
    })

    it('nothing-to-land', async () => {
      expect(
        await integrateAutomatically({
          prepare: async (repo, sessionId) => {
            const path = await describedThread(repo, sessionId)
            jj(path, 'abandon', '@')
            return path
          },
        }),
      ).toMatchInlineSnapshot(`
        {
          "agentFixes": [],
          "events": [
            {
              "detail": "Turn 3",
              "level": "notable",
              "summary": "Queued automatic integration for <thread>",
              "type": "workspace.auto_integration_queued",
            },
            {
              "detail": "Turn 3",
              "level": "routine",
              "summary": "Automatic integration found no remaining work.",
              "type": "workspace.auto_integration_nothing-to-land",
            },
          ],
        }
      `)
    })

    it('already-integrated', async () => {
      expect(
        await integrateAutomatically({
          prepare: async (repo, sessionId) => {
            const path = await harness.provisionThread(repo, { sessionIds: [sessionId], file: 'shared.txt' })
            writeFileSync(join(path, 'shared.txt'), 'one\nrepresented\n')
            advanceMain(repo, 'one\nrepresented\n')
            return path
          },
        }),
      ).toMatchInlineSnapshot(`
        {
          "agentFixes": [],
          "events": [
            {
              "detail": "Turn 3",
              "level": "notable",
              "summary": "Queued automatic integration for <thread>",
              "type": "workspace.auto_integration_queued",
            },
            {
              "detail": "Turn 3",
              "level": "routine",
              "summary": "All remaining revisions already match patches in main. No rebase or bookmark change was made.",
              "type": "workspace.auto_integration_already-integrated",
            },
          ],
        }
      `)
    })

    it('patch-equivalent-work', async () => {
      expect(
        await integrateAutomatically({
          prepare: async (repo, sessionId) => {
            const path = await harness.provisionThread(repo, { sessionIds: [sessionId], file: 'shared.txt' })
            writeFileSync(join(path, 'shared.txt'), 'one\nrepresented\n')
            advanceMain(repo, 'one\nrepresented\n')
            jj(path, 'new')
            writeFileSync(join(path, 'unique.txt'), 'unique\n')
            jj(path, 'describe', '-m', 'feat: unique work')
            return path
          },
        }),
      ).toMatchInlineSnapshot(`
        {
          "agentFixes": [
            "Automatic integration found revisions with exact patch matches in target history:
        - <change> (<commit>)
        Do not rebase this mixed branch automatically. Separate represented revisions from unique work, then stop for Project Checks again. The bookmark was not changed.",
          ],
          "events": [
            {
              "detail": "Turn 3",
              "level": "notable",
              "summary": "Queued automatic integration for <thread>",
              "type": "workspace.auto_integration_queued",
            },
            {
              "detail": "Turn 3",
              "level": "attention",
              "summary": "Automatic integration paused to avoid replaying represented patches.",
              "type": "workspace.auto_integration_patch-equivalent-work",
            },
          ],
        }
      `)
    })

    it('patch-equivalence-unavailable', async () => {
      expect(
        await integrateAutomatically({
          prepare: async (repo, sessionId) => {
            const path = await describedThread(repo, sessionId)
            writeFileSync(join(path, 'binary.dat'), Buffer.from([0, 255, 1, 0]))
            return path
          },
        }),
      ).toMatchInlineSnapshot(`
        {
          "agentFixes": [
            "Automatic integration could not safely compare these revision patches:
        - <change> (<commit>)
        Inspect the patches and target history manually. No rebase or bookmark change was made; stop for Project Checks again only after resolving the uncertainty.",
          ],
          "events": [
            {
              "detail": "Turn 3",
              "level": "notable",
              "summary": "Queued automatic integration for <thread>",
              "type": "workspace.auto_integration_queued",
            },
            {
              "detail": "Turn 3",
              "level": "attention",
              "summary": "Automatic integration paused because patch equivalence could not be proven.",
              "type": "workspace.auto_integration_patch-equivalence-unavailable",
            },
          ],
        }
      `)
    })

    it('detached-work', async () => {
      expect(
        await integrateAutomatically({
          prepare: async (repo, sessionId) => {
            const path = await describedThread(repo, sessionId)
            jj(path, 'new', 'main')
            return path
          },
        }),
      ).toMatchInlineSnapshot(`
        {
          "agentFixes": [
            "Automatic integration stopped because this thread has detached revisions that are not covered by the current completion checks:
        - <change> (<commit>)
        Inspect and reattach only the intended work into this thread’s active working copy, then stop for Project Checks again. Do not advance the bookmark or discard these revisions directly.",
          ],
          "events": [
            {
              "detail": "Turn 3",
              "level": "notable",
              "summary": "Queued automatic integration for <thread>",
              "type": "workspace.auto_integration_queued",
            },
            {
              "detail": "1 detached revision(s) · turn 3",
              "level": "attention",
              "summary": "Automatic integration paused for detached revisions.",
              "type": "workspace.auto_integration_detached-work",
            },
          ],
        }
      `)
    })

    it('needs-description', async () => {
      expect(
        await integrateAutomatically({
          prepare: async (repo, sessionId) => {
            const path = await describedThread(repo, sessionId)
            jj(path, 'describe', '-m', '')
            return path
          },
        }),
      ).toMatchInlineSnapshot(`
        {
          "agentFixes": [
            "Automatic integration onto \`main\` stopped because these revisions have no real description:
        - <change>
        Describe each revision with \`jj describe -r <change-id> -m "<conventional commit message>"\`. The bookmark was not advanced; after Project Checks pass again, the queue will retry.",
          ],
          "events": [
            {
              "detail": "Turn 3",
              "level": "notable",
              "summary": "Queued automatic integration for <thread>",
              "type": "workspace.auto_integration_queued",
            },
            {
              "detail": "1 revision(s) · turn 3",
              "level": "attention",
              "summary": "Automatic integration stopped on undescribed revisions.",
              "type": "workspace.auto_integration_needs-description",
            },
          ],
        }
      `)
    })

    it('conflicted', async () => {
      expect(
        await integrateAutomatically({
          prepare: async (repo, sessionId) => {
            const path = await harness.provisionThread(repo, { sessionIds: [sessionId], file: 'shared.txt' })
            advanceMain(repo, 'main side\n')
            return path
          },
        }),
      ).toMatchInlineSnapshot(`
        {
          "agentFixes": [
            "Automatic integration onto \`main\` stopped with conflicts in:
        - shared.txt
        Resolve them in this dedicated workspace and keep each revision described. The bookmark was not advanced; after Project Checks pass again, the queue will retry against the latest bookmark.",
          ],
          "events": [
            {
              "detail": "Turn 3",
              "level": "notable",
              "summary": "Queued automatic integration for <thread>",
              "type": "workspace.auto_integration_queued",
            },
            {
              "detail": "1 conflicted file(s) · turn 3",
              "level": "attention",
              "summary": "Automatic integration stopped on rebase conflicts.",
              "type": "workspace.auto_integration_conflicted",
            },
          ],
        }
      `)
    })

    it('verification-failed', async () => {
      expect(await integrateAutomatically({ prepare: describedThread, verdict: { status: 'failed', prompt: 'pnpm test failed on the rebased candidate.' } }))
        .toMatchInlineSnapshot(`
        {
          "agentFixes": [
            "pnpm test failed on the rebased candidate.",
          ],
          "events": [
            {
              "detail": "Turn 3",
              "level": "notable",
              "summary": "Queued automatic integration for <thread>",
              "type": "workspace.auto_integration_queued",
            },
            {
              "detail": "Turn 3",
              "level": "attention",
              "summary": "Project Checks did not verify the rebased candidate; the bookmark was not advanced.",
              "type": "workspace.auto_integration_verification-failed",
            },
          ],
        }
      `)
    })

    it('verification-stale (source changed after checks)', async () => {
      expect(await integrateAutomatically({ prepare: describedThread, staleSource: true })).toMatchInlineSnapshot(`
        {
          "agentFixes": [
            "The thread changed after its completion checks passed. Stop for Project Checks again; automatic integration did not rebase it.",
          ],
          "events": [
            {
              "detail": "Turn 3",
              "level": "notable",
              "summary": "Queued automatic integration for <thread>",
              "type": "workspace.auto_integration_queued",
            },
            {
              "detail": "Turn 3",
              "level": "attention",
              "summary": "Project Checks did not verify the rebased candidate; the bookmark was not advanced.",
              "type": "workspace.auto_integration_verification-failed",
            },
          ],
        }
      `)
    })

    it('verification-cancelled', async () => {
      expect(await integrateAutomatically({ prepare: describedThread, verdict: { status: 'cancelled', prompt: null } })).toMatchInlineSnapshot(`
        {
          "agentFixes": [],
          "events": [
            {
              "detail": "Turn 3",
              "level": "notable",
              "summary": "Queued automatic integration for <thread>",
              "type": "workspace.auto_integration_queued",
            },
            {
              "detail": "Turn 3",
              "level": "routine",
              "summary": "Automatic integration was cancelled before the bookmark moved.",
              "type": "workspace.auto_integration_cancelled",
            },
          ],
        }
      `)
    })

    it('failed (jj error before the bookmark moved)', async () => {
      try {
        const result = await integrateAutomatically({
          prepare: async (repo, sessionId) => {
            const path = await describedThread(repo, sessionId)
            harness.setSettings({ syncWorkspaceAfterLand: '', autoIntegrationScope: 'isolated', bookmark: 'missing-bookmark' })
            return path
          },
        })
        expect(result).toMatchInlineSnapshot(`
          {
            "agentFixes": [
              "Automatic integration could not safely rebase this thread. The main bookmark was not advanced; resolve the issue and stop again, or integrate manually.",
            ],
            "events": [
              {
                "detail": "Turn 3",
                "level": "notable",
                "summary": "Queued automatic integration for <thread>",
                "type": "workspace.auto_integration_queued",
              },
              {
                "detail": "Turn 3",
                "level": "attention",
                "summary": "Automatic integration stopped before advancing the bookmark.",
                "type": "workspace.auto_integration_failed",
              },
            ],
          }
        `)
      } finally {
        harness.setSettings({ syncWorkspaceAfterLand: '', autoIntegrationScope: 'isolated' })
      }
    })

    it('stays silent for a shared checkout or when the scope is none', async () => {
      const sessionId = 'session-auto-shared'
      harness.setSession(sessionId, { running: false, questions: 0 })
      const repo = freshRepository()
      await harness.register(repo, [sessionId])
      const eventStart = harness.events.length
      expect(await harness.verifyTurn({ sessionId, path: repo })).toEqual([])
      harness.setSettings({ syncWorkspaceAfterLand: '', autoIntegrationScope: 'none' })
      try {
        const threadSession = 'session-auto-none'
        harness.setSession(threadSession, { running: false, questions: 0 })
        const path = await harness.provisionThread(repo, { sessionIds: [threadSession] })
        expect(await harness.verifyTurn({ sessionId: threadSession, path })).toEqual([])
      } finally {
        harness.setSettings({ syncWorkspaceAfterLand: '', autoIntegrationScope: 'isolated' })
      }
      expect(eventsSince(eventStart).filter(event => event.type.startsWith('workspace.auto_integration'))).toEqual([])
    })
  })
})

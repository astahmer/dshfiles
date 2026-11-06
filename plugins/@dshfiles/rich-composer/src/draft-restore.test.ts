// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionInputShell } from './native/input/facade.ts'
import type { CommandClaim, InputTriggerController, SubmitOutcome } from './native/contract/input.ts'

// Rendering is outside these restore tests; keep the real Lexical nodes, facade and submit machine.
vi.mock('./native/input/editor/ReferenceChip.tsx', () => ({ ReferenceChip: () => null }))
vi.mock('./native/input/editor/CommandChip.tsx', () => ({ CommandChip: () => null }))

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

const claim = (name: string): CommandClaim => ({ name, token: `/${name} `, submit: async () => ({ kind: 'success' }) })

const deferredResolution = () => {
  let resolveClaim: (value: CommandClaim | undefined) => void = () => undefined
  let rejectClaim: () => void = () => undefined
  const promise = new Promise<CommandClaim | undefined>((resolve, reject) => {
    resolveClaim = resolve
    rejectClaim = () => reject(new Error('catalog warmup failed'))
  })
  return { promise, resolveClaim, rejectClaim }
}

function fixture(sink: (text: string) => Promise<SubmitOutcome>) {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const resolutions: { token: string; resolution: ReturnType<typeof deferredResolution> }[] = []
  const triggers: InputTriggerController = {
    launcher: createSnapshotStore<string | null>(null),
    lexicon: createSnapshotStore<ReadonlyMap<'/' | '@', readonly string[]>>(new Map()),
    track: () => undefined,
    arbitrate: () => 'pass',
    onSpace: () => false,
    serializeReference: async () => '',
    adjudicate: async () => undefined,
    resolveClaim: token => {
      const resolution = deferredResolution()
      resolutions.push({ token, resolution })
      return resolution.promise
    },
    openReference: () => false,
    toggleSource: () => undefined,
  }
  const shell = new SessionInputShell({
    actx: ctx,
    inputTriggers: () => triggers,
    defaultSink: text => sink(text),
    commandAttachments: { serialize: async () => [], release: () => undefined, unsupportedNotice: token => token },
  })
  cleanups.push(() => {
    shell.dispose()
  })
  return { shell, resolutions }
}

describe('composer restore state', () => {
  it('restores a failed send into the emptied draft', async () => {
    const admitted = Promise.withResolvers<SubmitOutcome>()
    const { shell } = fixture(() => admitted.promise)
    shell.setDraft('A sent answer')
    shell.submit()
    expect(shell.snapshot.draft).toBe('')

    admitted.resolve({ kind: 'error', text: 'refused' })

    await vi.waitFor(() => expect(shell.snapshot.draft).toBe('A sent answer'))
    expect(shell.notices.getSnapshot()?.text).toBe('refused')
  })

  it('keeps a failure out of the way of text typed after the send', async () => {
    const admitted = Promise.withResolvers<SubmitOutcome>()
    const { shell } = fixture(() => admitted.promise)
    shell.setDraft('A sent answer')
    shell.submit()
    shell.setDraft('typed later')

    admitted.resolve({ kind: 'error', text: 'refused' })

    await vi.waitFor(() => expect(shell.notices.getSnapshot()?.text).toBe('refused'))
    expect(shell.snapshot.draft).toBe('typed later')
  })

  it('rebuilds a restored command chip at the revision its restore produced', async () => {
    const { shell, resolutions } = fixture(async () => ({ kind: 'success' }))
    shell.setDraft({ text: '/goal ship it', references: [], command: { token: '/goal ' } })

    expect(resolutions.map(candidate => candidate.token)).toEqual(['/goal'])

    resolutions[0]?.resolution.resolveClaim(claim('goal'))

    await vi.waitFor(() => expect(shell.snapshot.claim?.name).toBe('goal'))
    expect(shell.snapshot.phase).toBe('claimed')
  })

  it('never applies the claim of a superseded restore', async () => {
    const { shell, resolutions } = fixture(async () => ({ kind: 'success' }))
    shell.setDraft({ text: '/goal one', references: [], command: { token: '/goal ' } })
    shell.setDraft({ text: '/other two', references: [], command: { token: '/other ' } })
    expect(resolutions.map(candidate => candidate.token)).toEqual(['/goal', '/other'])

    resolutions[0]?.resolution.resolveClaim(claim('goal'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(shell.snapshot.claim).toBeUndefined()
    expect(shell.snapshot.draft).toBe('/other two')

    resolutions[1]?.resolution.resolveClaim(claim('other'))
    await vi.waitFor(() => expect(shell.snapshot.claim?.name).toBe('other'))
  })

  it('keeps the literal token when the restored claim cannot resolve', async () => {
    const { shell, resolutions } = fixture(async () => ({ kind: 'success' }))
    shell.setDraft({ text: '/goal ship it', references: [], command: { token: '/goal ' } })

    resolutions[0]?.resolution.rejectClaim()

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(shell.snapshot.draft).toBe('/goal ship it')
    expect(shell.snapshot.phase).toBe('plain')
    expect(shell.snapshot.claim).toBeUndefined()
  })
})

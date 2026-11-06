// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { VoiceCapture } from './composer-audio.js'
import { useVoiceCapture, type VoiceCaptureControl } from './composer-voice.js'

beforeAll(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))

const fakeCapture = (): VoiceCapture => ({
  startedAt: 0,
  stop: vi.fn(async () => new Uint8Array([1])),
  cancel: vi.fn(async () => {}),
})

const harness = () => {
  let grant: (capture: VoiceCapture) => void = () => {}
  const start = vi.fn(() => new Promise<VoiceCapture>(resolve => (grant = resolve)))
  const transcribe = vi.fn(async (recording: () => Promise<Uint8Array>) => void (await recording()))
  const rendered = new Map<'voice', VoiceCaptureControl>()
  const Probe = () => {
    rendered.set('voice', useVoiceCapture({ start, transcribe, onStarted: () => {}, onStartFailed: () => {}, maxDurationMs: 120_000 }))
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(<Probe />))
  return { root, start, transcribe, voice: () => rendered.get('voice'), grant: (capture: VoiceCapture) => grant(capture) }
}

describe('composer voice capture', () => {
  it('ignores a second click while the microphone is being granted', async () => {
    const { root, start, voice, grant } = harness()
    act(() => voice()?.toggle())
    act(() => voice()?.toggle())
    expect(start).toHaveBeenCalledOnce()
    expect(voice()?.phase).toBe('starting')
    await act(async () => grant(fakeCapture()))
    expect(voice()?.phase).toBe('recording')
    act(() => root.unmount())
  })

  it('releases a microphone granted after the composer left', async () => {
    const { root, voice, grant } = harness()
    act(() => voice()?.toggle())
    act(() => root.unmount())
    const capture = fakeCapture()
    await act(async () => grant(capture))
    expect(capture.cancel).toHaveBeenCalledOnce()
  })

  it('records, then transcribes, then returns to idle', async () => {
    const { root, transcribe, voice, grant } = harness()
    act(() => voice()?.toggle())
    const capture = fakeCapture()
    await act(async () => grant(capture))
    await act(async () => voice()?.toggle())
    expect(capture.stop).toHaveBeenCalledOnce()
    expect(transcribe).toHaveBeenCalledOnce()
    expect(voice()?.phase).toBe('idle')
    act(() => root.unmount())
  })
})

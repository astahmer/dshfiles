import assert from 'node:assert/strict'
import { beforeEach, test, vi } from 'vitest'

type AudioModel = typeof import('./thread-notification-audio.js').ThreadNotificationAudioModel

class FakeAudioParam {
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
  exponentialRampToValueAtTime(): void {}
}

class FakeGainNode {
  readonly gain = new FakeAudioParam()
  connect(): void {}
}

class FakeOscillatorNode {
  type = 'sine'
  readonly frequency = new FakeAudioParam()
  readonly startedAt: number[] = []
  connect(): void {}
  start(at: number): void {
    this.startedAt.push(at)
  }
  stop(): void {}
}

class FakeAudioContext {
  state: AudioContextState = 'suspended'
  currentTime = 0
  readonly destination = {}
  readonly oscillators: FakeOscillatorNode[] = []
  readonly resumeCalls: number[] = []
  constructor() {
    createdContexts.push(this)
  }
  async resume(): Promise<void> {
    this.resumeCalls.push(this.currentTime)
    this.state = 'running'
  }
  createOscillator(): FakeOscillatorNode {
    const oscillator = new FakeOscillatorNode()
    this.oscillators.push(oscillator)
    return oscillator
  }
  createGain(): FakeGainNode {
    return new FakeGainNode()
  }
}

const createdContexts: FakeAudioContext[] = []

const installFakeAudio = (options?: { readonly audioContext?: boolean }): void => {
  createdContexts.length = 0
  const browser = options?.audioContext === false ? {} : { AudioContext: FakeAudioContext }
  Object.defineProperty(globalThis, 'window', { value: browser, configurable: true })
}

const loadAudioModel = async (): Promise<AudioModel> => {
  vi.resetModules()
  const module = await import('./thread-notification-audio.js')
  return module.ThreadNotificationAudioModel
}

beforeEach(() => {
  installFakeAudio()
})

test('a notification sound resumes the audio context and starts a tone without a prior settings visit', async () => {
  const audio = await loadAudioModel()
  audio.play('chime', 0.5)
  await vi.waitFor(() => assert.equal(createdContexts.length, 1))
  const context = createdContexts[0]
  assert.ok(context !== undefined)
  await vi.waitFor(() => assert.equal(context.oscillators.length > 0, true))
  assert.equal(context.state, 'running')
  assert.equal(context.resumeCalls.length, 1)
})

test('previewing a sound reports success and starts a tone', async () => {
  const audio = await loadAudioModel()
  assert.equal(await audio.preview('bright', 0.4), true)
  const context = createdContexts[0]
  assert.ok(context !== undefined)
  assert.equal(context.oscillators.length > 0, true)
})

test('a silent volume still unlocks audio but plays nothing', async () => {
  const audio = await loadAudioModel()
  assert.equal(await audio.preview('soft', 0), true)
  assert.equal(createdContexts[0]?.oscillators.length, 0)
})

test('a browser without AudioContext cannot preview or play', async () => {
  installFakeAudio({ audioContext: false })
  const audio = await loadAudioModel()
  assert.equal(await audio.preview('soft', 0.5), false)
  assert.equal(await audio.unlock(), false)
  audio.play('soft', 0.5)
  assert.equal(createdContexts.length, 0)
})

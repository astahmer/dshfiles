import { describe, expect, it } from 'vitest'
import { DeviceLoginModel, type DeviceLoginPhase } from './device-login-machine.js'

const prompt = { userCode: 'ABCD-EFGH', verificationUri: 'https://auth.openai.com/codex/device' } as const
const idle: DeviceLoginPhase = { kind: 'idle', message: null }
const starting: DeviceLoginPhase = { kind: 'starting', message: 'Starting…' }
const waiting: DeviceLoginPhase = { kind: 'waiting', message: 'Enter this code', prompt }
const complete: DeviceLoginPhase = { kind: 'complete', message: 'Connected.', prompt }
const failed: DeviceLoginPhase = { kind: 'failed', message: 'Failed.', failure: 'failed', prompt }
const cancelled: DeviceLoginPhase = { kind: 'cancelled', message: 'Cancelled.' }

describe('shared device-login phase', () => {
  it('moves through start → run → device → adopt → complete', () => {
    const run = DeviceLoginModel.transition(starting, { type: 'run' })
    expect(run).toEqual({ kind: 'running', message: 'Starting…' })
    const device = DeviceLoginModel.transition(run, { type: 'device', message: 'Enter this code', prompt })
    expect(device).toEqual(waiting)
    const adopting = DeviceLoginModel.transition(device, { type: 'adopt' })
    expect(adopting).toEqual({ kind: 'adopting', message: 'Enter this code', prompt })
    expect(DeviceLoginModel.transition(adopting, { type: 'complete', message: 'Connected.' })).toEqual(complete)
  })

  it('keeps a device code only while the user can act on it', () => {
    expect(DeviceLoginModel.prompt(waiting)).toEqual(prompt)
    expect(DeviceLoginModel.prompt(DeviceLoginModel.transition(waiting, { type: 'complete', message: 'Connected.' }))).toEqual(prompt)
    expect(DeviceLoginModel.prompt(DeviceLoginModel.transition(waiting, { type: 'cancel', message: 'Cancelled.' }))).toBeNull()
    expect(DeviceLoginModel.prompt(DeviceLoginModel.transition(waiting, { type: 'reset', message: 'Signed out.' }))).toBeNull()
    expect(DeviceLoginModel.transition(starting, { type: 'device', message: 'Late code', prompt })).toEqual({
      kind: 'waiting',
      message: 'Late code',
      prompt,
    })
  })

  it('ignores events that would contradict an already decided outcome', () => {
    expect(DeviceLoginModel.transition(complete, { type: 'cancel', message: 'Cancelled.' })).toEqual(complete)
    expect(DeviceLoginModel.transition(complete, { type: 'device', message: 'Enter this code', prompt })).toEqual(complete)
    expect(DeviceLoginModel.transition(complete, { type: 'adopt' })).toEqual(complete)
    expect(DeviceLoginModel.transition(cancelled, { type: 'complete', message: 'Connected.' })).toEqual(cancelled)
    expect(DeviceLoginModel.transition(cancelled, { type: 'fail', message: 'Failed.', failure: 'failed' })).toEqual(cancelled)
    expect(DeviceLoginModel.transition(failed, { type: 'fail', message: 'Failed again.', failure: 'failed' })).toEqual(failed)
    expect(DeviceLoginModel.transition(waiting, { type: 'start', message: 'Restarted' })).toEqual(waiting)
  })

  it('only starts a new attempt from a settled phase', () => {
    expect(DeviceLoginModel.transition(idle, { type: 'start', message: 'Starting…' })).toEqual(starting)
    expect(DeviceLoginModel.transition(failed, { type: 'start', message: 'Starting…' })).toEqual(starting)
    expect(DeviceLoginModel.transition(cancelled, { type: 'start', message: 'Starting…' })).toEqual(starting)
    expect(DeviceLoginModel.transition(waiting, { type: 'start', message: 'Restarted' })).toEqual(waiting)
  })

  it('lets a post-adoption route refresh fail the attempt without reopening cancellation', () => {
    expect(DeviceLoginModel.transition(complete, { type: 'fail', message: 'Saved, but routes did not refresh.', failure: 'refresh-failed' })).toEqual({
      kind: 'failed',
      message: 'Saved, but routes did not refresh.',
      failure: 'refresh-failed',
      prompt,
    })
    expect(DeviceLoginModel.transition(complete, { type: 'cancel', message: 'Cancelled.' })).toEqual(complete)
  })

  it('reports an active phase only while an attempt owns work', () => {
    expect([idle, starting, waiting, complete, failed, cancelled].map(phase => DeviceLoginModel.isActive(phase))).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
    ])
    expect(DeviceLoginModel.isActive(DeviceLoginModel.transition(waiting, { type: 'adopt' }))).toBe(true)
    expect(DeviceLoginModel.isActive(DeviceLoginModel.transition(waiting, { type: 'fail', message: 'Failed.', failure: 'failed' }))).toBe(false)
  })

  it('lets a staging cleanup failure replace any decided phase', () => {
    expect(DeviceLoginModel.transition(complete, { type: 'cleanup-failed', message: 'Cleanup failed.', failure: 'cleanup-failed' })).toEqual({
      kind: 'failed',
      message: 'Cleanup failed.',
      failure: 'cleanup-failed',
      prompt,
    })
    expect(DeviceLoginModel.transition(cancelled, { type: 'cleanup-failed', message: 'Cleanup failed.', failure: 'cleanup-failed' })).toEqual({
      kind: 'failed',
      message: 'Cleanup failed.',
      failure: 'cleanup-failed',
      prompt: null,
    })
    expect(DeviceLoginModel.transition(idle, { type: 'cleanup-failed', message: 'Cleanup failed.', failure: 'cleanup-failed' })).toEqual(idle)
  })

  it('projects one public status vocabulary for both providers', () => {
    expect([idle, starting, waiting, complete, failed, cancelled].map(phase => DeviceLoginModel.view(phase))).toEqual([
      { status: 'idle', message: null, prompt: null, failure: null },
      { status: 'starting', message: 'Starting…', prompt: null, failure: null },
      { status: 'waiting', message: 'Enter this code', prompt, failure: null },
      { status: 'complete', message: 'Connected.', prompt, failure: null },
      { status: 'error', message: 'Failed.', prompt, failure: 'failed' },
      { status: 'cancelled', message: 'Cancelled.', prompt: null, failure: null },
    ])
    expect(DeviceLoginModel.view(DeviceLoginModel.transition(waiting, { type: 'adopt' }))).toMatchObject({ status: 'waiting', prompt })
    expect(DeviceLoginModel.view(DeviceLoginModel.transition(waiting, { type: 'fail', message: 'Failed.', failure: 'failed' }))).toMatchObject({
      status: 'error',
      prompt,
      failure: 'failed',
    })
  })
})

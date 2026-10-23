import { describe, expect, it } from 'vitest'
import { ReceiverDiagnosis } from './diagnosis.js'
import type { Exporters } from './types.js'

const localExporters: Exporters = {
  traces: { source: 'local-receiver', url: 'http://127.0.0.1:4318/v1/traces' },
  metrics: { source: 'local-receiver', url: 'http://127.0.0.1:4318/v1/metrics' },
  environmentPointsHere: null,
}

const listening = {
  mode: 'plugin',
  state: 'listening',
  endpoint: 'http://127.0.0.1:4318',
  configuredPort: 4318,
  receiverMessage: null,
  lastReceivedAt: null,
  exporters: localExporters,
} as const

describe('ReceiverDiagnosis.diagnose', () => {
  it('waits for the in-process exporters, then reports telemetry arriving', () => {
    expect(ReceiverDiagnosis.diagnose(listening)).toMatchObject({ code: 'waiting', message: expect.stringContaining('without any environment variable') })
    expect(ReceiverDiagnosis.diagnose({ ...listening, lastReceivedAt: 1 }).code).toBe('receiving')
  })

  it('names an environment endpoint pointing elsewhere and the supervisor restart that fixes it', () => {
    const diagnosis = ReceiverDiagnosis.diagnose({
      ...listening,
      lastReceivedAt: 1,
      exporters: { ...localExporters, traces: { source: 'environment', url: 'http://collector:4318/v1/traces' }, environmentPointsHere: false },
    })
    expect(diagnosis.code).toBe('exporting-elsewhere')
    expect(diagnosis.message).toContain('http://collector:4318/v1/traces')
    expect(diagnosis.message).toContain(ReceiverDiagnosis.restartHint)
  })

  it('says when this process has no exporter at all', () => {
    expect(
      ReceiverDiagnosis.diagnose({ ...listening, exporters: { ...localExporters, traces: { source: 'off', url: null }, environmentPointsHere: null } }).code,
    ).toBe('no-exporter')
  })

  it('puts external mode and a held port before exporter checks', () => {
    expect(ReceiverDiagnosis.diagnose({ ...listening, mode: 'external', state: 'disabled', endpoint: null }).code).toBe('external-mode')
    expect(ReceiverDiagnosis.diagnose({ ...listening, state: 'port-in-use', endpoint: null }).code).toBe('port-in-use')
    expect(ReceiverDiagnosis.diagnose({ ...listening, state: 'failed', endpoint: null, receiverMessage: 'EACCES' })).toEqual({
      code: 'failed',
      message: 'EACCES',
    })
  })
})

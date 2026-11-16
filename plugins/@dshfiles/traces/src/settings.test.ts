import { expect, test } from 'vitest'
import { tracesSettings } from './settings.js'

const advanced = ['host', 'allowNonLoopback', 'port', 'forwardUrl', 'retentionHours', 'retentionSpans', 'retentionLogs', 'retentionMetricPoints', 'eventLoopStallMs']

test('receiver, retention and stall-probe settings fold under Advanced; everyday ones stay level', () => {
  const fields = tracesSettings.schema.dict ?? {}
  for (const key of advanced) expect([key, fields[key]?.meta.collapse]).toEqual([key, true])
  for (const key of ['mode', 'externalViewerUrl', 'redactGenAiContent', 'announceResolved']) expect([key, fields[key]?.meta.collapse ?? false]).toEqual([key, false])
})

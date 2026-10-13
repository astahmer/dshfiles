import { describe, expect, it } from 'vitest'
import { featureCatalogIssues } from '../src/project/features.js'

const feature = {
  id: 'reorder-message',
  title: 'Reorder a queued message',
  summary: 'Move a pending message while preserving its identity and content.',
  surfaces: ['client', 'host'],
  configuration: [
    {
      key: 'previewLength',
      defaultValue: '200',
      constraints: 'Integer from 40 to 1000.',
      choices: ['40', '200', '1000'],
      coveredBy: ['queue-reorder.message-preview'],
    },
  ],
  states: ['idle', 'dragging', 'saving', 'failed'],
  failureModes: ['The item disappeared before the move was applied.'],
  externalDependencies: [],
  verification: [
    { kind: 'gherkin', id: 'queue-reorder.move-message', featureFile: 'tooling/dshx/e2e/features/queue-reorder.feature' },
    {
      kind: 'unit-test',
      id: 'queue-reorder.message-preview',
      file: 'plugins/@dshfiles/queue-reorder/src/queue-edit.test.ts',
      testName: 'edits pending text messages',
    },
  ],
}

describe('plugin feature metadata', () => {
  it('accepts feature behavior and configuration linked to declared scenarios', () => {
    expect(featureCatalogIssues({ schemaVersion: 1, kind: 'bundle', features: [feature] })).toEqual([])
  })

  it('rejects malformed metadata, repeated identifiers and uncovered configuration values', () => {
    expect(featureCatalogIssues({ schemaVersion: 1, kind: 'bundle', features: [{ ...feature, verification: [] }] })).toEqual(
      expect.arrayContaining([expect.stringContaining('verification')]),
    )
    expect(featureCatalogIssues({ schemaVersion: 1, kind: 'bundle', features: [feature, feature] })).toEqual(
      expect.arrayContaining([expect.stringContaining('duplicate feature id'), expect.stringContaining('duplicate verification id')]),
    )
    expect(
      featureCatalogIssues({
        schemaVersion: 1,
        kind: 'bundle',
        features: [{ ...feature, configuration: [{ ...feature.configuration[0], defaultValue: '80', coveredBy: ['missing'] }] }],
      }),
    ).toEqual(expect.arrayContaining([expect.stringContaining('coveredBy'), expect.stringContaining('choices must include defaultValue')]))
  })
})

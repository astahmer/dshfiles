import { describe, expect, it } from 'vitest'
import { featureCatalogIssues, parseReachStep } from '../src/project/features.js'

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
  telemetry: [{ kind: 'automatic', source: 'api-dispatch' }],
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

  it('requires telemetry on every feature and agent-tool on tool surfaces', () => {
    const withTelemetry = (patch: Record<string, unknown>) => featureCatalogIssues({ schemaVersion: 1, kind: 'bundle', features: [{ ...feature, ...patch }] })
    expect(withTelemetry({ telemetry: [] })).toEqual(expect.arrayContaining([expect.stringContaining('telemetry')]))
    expect(withTelemetry({ telemetry: [{ kind: 'automatic', source: 'unknown' }] })).toEqual(expect.arrayContaining([expect.stringContaining('telemetry')]))
    expect(withTelemetry({ surfaces: ['tool'] })).toEqual([expect.stringContaining('list { kind: automatic, source: agent-tool }')])
    const notApplicable = [{ kind: 'not-applicable', reason: 'Client presentation only; no Host call.' }]
    expect(withTelemetry({ telemetry: notApplicable })).toEqual([])
    expect(withTelemetry({ surfaces: ['tool'], telemetry: notApplicable })).toEqual([expect.stringContaining('list { kind: automatic, source: agent-tool }')])
    expect(withTelemetry({ telemetry: [...notApplicable, { kind: 'automatic', source: 'api-dispatch' }] })).toEqual([
      expect.stringContaining('a not-applicable telemetry rationale stands alone'),
    ])
    expect(withTelemetry({ telemetry: [{ kind: 'custom', span: 'Backlog Triage', file: 'x.test.ts', testName: 'y' }] })).toEqual([
      expect.stringContaining('span names are lowercase'),
    ])
    expect(withTelemetry({ telemetry: [{ kind: 'custom', span: 'jj <subcommand>', file: 'x.test.ts', testName: 'y' }] })).toEqual([])
  })

  it('accepts reach steps a scratch DSH can run and rejects ones it cannot', () => {
    const withReach = (reach: readonly string[]) => featureCatalogIssues({ schemaVersion: 1, kind: 'bundle', features: [{ ...feature, reach }] })
    expect(
      withReach(['click button "Choose workspace"', 'fill textbox "Search" "sample"', 'expect option "sample*"', 'press Enter', 'expect checkbox "workspace"']),
    ).toEqual([])
    expect(withReach(['attach "tooling/dshx/e2e/fixtures/attachments/red.png"', 'expect button "Remove image red.png"'])).toEqual([])
    for (const outside of ['attach "/etc/hosts"', 'attach "../secrets.txt"', 'attach "plugins/../../x"']) {
      expect(withReach([outside, 'expect text "x"'])).toEqual(expect.arrayContaining([expect.stringContaining('reach steps are')]))
    }
    expect(withReach(['open the queue panel'])).toEqual(expect.arrayContaining([expect.stringContaining('reach steps are')]))
    expect(withReach(['fill text "Queue" "x"', 'expect text "Queue"'])).toEqual(expect.arrayContaining([expect.stringContaining('reach steps are')]))
    expect(withReach(['click button "Queue"'])).toEqual(expect.arrayContaining([expect.stringContaining('must end with an expect step')]))
  })

  it('accepts context-menu clicks and seeds that come before the walk', () => {
    const withReach = (reach: readonly string[]) => featureCatalogIssues({ schemaVersion: 1, kind: 'bundle', features: [{ ...feature, reach }] })
    expect(withReach(['seed rebase-ready-thread', 'seed pending-restart', 'rightclick text "Seeded*"', 'expect menuitem "Mark unread"'])).toEqual([])
    expect(withReach(['seed shared-workspaces', 'click button "Show 2 more workspaces"', 'expect text "review-05"'])).toEqual([])
    expect(
      withReach([
        'seed fake-secret-cli',
        'seed backlog-jev-enabled',
        'seed jev-setup-chat-thread',
        'expect button "Set up missing secrets"',
        'click button "Set up missing secrets"',
        'expect textbox "Secret value"',
      ]),
    ).toEqual([])
    expect(withReach(['hover button "Reveal TOKEN"', 'expect text "Click to reveal"'])).toEqual([])
    expect(withReach(['seed a-thread', 'expect text "x"'])).toEqual(expect.arrayContaining([expect.stringContaining('reach steps are')]))
    expect(withReach(['click button "New thread"', 'seed rebase-ready-thread', 'expect text "x"'])).toEqual(
      expect.arrayContaining([expect.stringContaining('seed steps come first')]),
    )
  })

  it('reads escaped quotes and backslashes in a fill value, so a tool directive can carry JSON', () => {
    const step = String.raw`fill textbox "Message" "[[call bash {\"command\":\"echo \\u0041\"}]]"`
    expect(parseReachStep(step)).toEqual({ action: 'fill', by: 'textbox', name: 'Message', value: String.raw`[[call bash {"command":"echo \u0041"}]]` })
    const withReach = (reach: readonly string[]) => featureCatalogIssues({ schemaVersion: 1, kind: 'bundle', features: [{ ...feature, reach }] })
    expect(withReach([step, 'expect text "x"'])).toEqual([])
    expect(withReach(['fill textbox "Message" "an "unescaped" quote"', 'expect text "x"'])).toEqual(
      expect.arrayContaining([expect.stringContaining('reach steps are')]),
    )
  })

  it('accepts a pointer step that hits a point of the element box, and only a well-formed point', () => {
    const withReach = (reach: readonly string[]) => featureCatalogIssues({ schemaVersion: 1, kind: 'bundle', features: [{ ...feature, reach }] })
    expect(withReach(['rightclick text "Mute target" at 24,16', 'expect menuitem "Mute"'])).toEqual([])
    expect(withReach(['click button "Pin" at 0,0', 'expect img "Unread"'])).toEqual([])
    expect(withReach(['hover text "Row" at 24,16', 'expect text "x"'])).toEqual([])
    for (const malformed of [
      'rightclick text "Mute target" at 24',
      'rightclick text "Mute target" at 24,',
      'expect text "x" at 24,16',
      'fill textbox "Name" "x" at 24,16',
    ]) {
      expect(withReach([malformed, 'expect text "x"'])).toEqual(expect.arrayContaining([expect.stringContaining('reach steps are')]))
    }
  })
})

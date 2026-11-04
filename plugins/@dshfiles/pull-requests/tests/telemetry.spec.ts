import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { withGitHubCommandSpan } from '../src/github-cli.js'

const pluginPackage = '@dshfiles/pull-requests'

describe('pull-requests telemetry', () => {
  it('records one span for repository discovery and pull-request polling', async () => {
    using recorder = recordSpans()
    const work = Effect.all(
      [
        withGitHubCommandSpan({
          name: 'pull request gh repo',
          attributes: { 'dshx.plugin.package': pluginPackage },
          effect: Effect.void,
        }),
        withGitHubCommandSpan({
          name: 'pull request gh view',
          attributes: { 'dshx.plugin.package': pluginPackage, 'github.repository': 'acme/widget', 'github.pull_request.number': 42 },
          effect: Effect.void,
        }),
      ],
      { concurrency: 'unbounded' },
    ).pipe(Effect.provide(DshxEffect.tracerLayer))

    await Effect.runPromise(work)

    expect(recorder.span('pull request gh repo').status.code).toBe('unset')
    expect(recorder.span('pull request gh view').attributes).toMatchObject({
      'github.repository': 'acme/widget',
      'github.pull_request.number': 42,
    })
  })
})

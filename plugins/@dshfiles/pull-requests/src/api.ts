import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import {
  pullRequestLinkInputSchema,
  pullRequestListInputSchema,
  pullRequestListOutputSchema,
  pullRequestMutationOutputSchema,
  pullRequestRemovalOutputSchema,
  pullRequestTargetInputSchema,
} from './pull-request-model.js'

const ONLY_WHEN_ASKED = 'Call only when the user asked for this.'

const renderLink = (output: Schema.Schema.Type<typeof pullRequestMutationOutputSchema>): string => {
  const link = output.link
  const state = link.lastKnownState === null ? 'state unknown' : link.lastKnownState.state.toLowerCase()
  return `${link.watching ? 'Watching' : 'Linked'} ${link.repo}#${String(link.number)} (${state}) for thread ${link.sessionId}.`
}

export const pullRequestApi = defineApi({
  id: 'pull-requests',
  version: 1,
  owner: '@dshfiles/pull-requests',
  methods: {
    link: method({
      input: pullRequestLinkInputSchema,
      output: pullRequestMutationOutputSchema,
      description: `Link a GitHub pull request to a DSH thread by GitHub URL, or by number and repository cwd. The session id defaults to the calling thread. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'pull_request_link', render: renderLink },
    }),
    unlink: method({
      input: pullRequestTargetInputSchema,
      output: pullRequestRemovalOutputSchema,
      description: `Remove one GitHub pull-request link from a DSH thread. Specify the URL or repository and number; the session id defaults to the calling thread. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'pull_request_unlink',
        render: output => `${output.removed ? 'Unlinked' : 'No link found for'} ${output.repo}#${String(output.number)} from thread ${output.sessionId}.`,
      },
    }),
    list: method({
      input: pullRequestListInputSchema,
      output: pullRequestListOutputSchema,
      description:
        'List GitHub pull-request links for one thread (defaults to the calling thread) or across all threads with all: true, including each link’s last known state and whether it is watched. Read-only.',
      tool: {
        name: 'pull_request_list',
        readOnly: true,
        render: output =>
          output.links
            .map(link => {
              const state = link.lastKnownState?.state.toLowerCase() ?? 'unknown'
              return `${link.sessionId} · ${link.repo}#${String(link.number)} · ${state}${link.watching ? ' · watching' : ''}`
            })
            .join('\n') || 'No pull-request links.',
      },
    }),
    watch: method({
      input: pullRequestLinkInputSchema,
      output: pullRequestMutationOutputSchema,
      description: `Start watching a GitHub pull request; watching creates the thread link if needed. The session id defaults to the calling thread. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'pull_request_watch', render: renderLink },
    }),
    unwatch: method({
      input: pullRequestTargetInputSchema,
      output: pullRequestMutationOutputSchema,
      description: `Stop watching one linked GitHub pull request without removing its thread link. The session id defaults to the calling thread. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'pull_request_unwatch', render: renderLink },
    }),
  },
})

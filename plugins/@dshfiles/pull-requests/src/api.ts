import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import {
  pullRequestCreateInputSchema,
  pullRequestCreateOutputSchema,
  pullRequestCreatePreviewInputSchema,
  pullRequestCreatePreviewSchema,
  type PullRequestCreateOutput,
  type PullRequestCreatePreview,
} from './create-model.js'
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

const renderPreview = (preview: PullRequestCreatePreview): string => {
  const lines = [
    `${preview.status === 'ready' ? 'Ready' : 'Blocked'}: ${preview.repo ?? 'unknown repository'} ${preview.bookmark ?? '?'} → ${preview.base ?? '?'} (${String(preview.commits.length)} commit(s); head ${preview.headCommitId?.slice(0, 12) ?? 'none'}).`,
    ...preview.commits.map(commit => `- ${commit.changeId} ${commit.summary || '(no description)'}`),
    ...preview.problems.map(problem => `Problem (${problem.code}): ${problem.message} Recovery: ${problem.recovery}`),
    preview.existingUrl === null ? '' : `An open pull request already uses this bookmark: ${preview.existingUrl}; create will link it.`,
    `Title (${preview.generation.source}${preview.generation.source === 'model' ? ` ${preview.generation.note}` : ''}): ${preview.title}`,
    preview.generation.source === 'fallback' ? `Draft note: ${preview.generation.note}` : '',
    '',
    preview.body,
  ]
  return lines.filter((line, index) => line.length > 0 || index === lines.length - 2).join('\n')
}

const renderCreate = (output: PullRequestCreateOutput): string =>
  output.status === 'created'
    ? `${output.opened ? 'Opened' : 'Linked existing'} ${output.url} for thread ${output.link.sessionId}${output.link.watching ? '; watching it' : ''}.`
    : `Pull request not created (${output.stage}): ${output.message} Recovery: ${output.recovery}${output.pushed ? ' The branch was pushed.' : ''}`

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
    createPreview: method({
      input: pullRequestCreatePreviewInputSchema,
      output: pullRequestCreatePreviewSchema,
      description:
        'Preview creating a GitHub pull request from a thread’s jj workspace: the repository, base branch, bookmark to push, the commits above the base, a title and body drafted from the thread with its model, an existing open pull request for the bookmark, and every blocking problem with its recovery. Changes nothing (it only reads jj, gh and the thread). Pass its bookmark, base, headCommitId, title and body to pull_request_create. Read-only.',
      tool: { name: 'pull_request_create_preview', readOnly: true, render: renderPreview },
    }),
    create: method({
      input: pullRequestCreateInputSchema,
      output: pullRequestCreateOutputSchema,
      description: `Create a GitHub pull request from a thread’s jj workspace after pull_request_create_preview: sets the bookmark on the previewed head commit, pushes it with jj git push, runs gh pr create (or reuses an open pull request for the bookmark), then links and watches it on the thread. Requires confirm: true and the preview’s headCommitId; refuses when the workspace moved. Publishes to GitHub. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'pull_request_create', render: renderCreate },
    }),
    unwatch: method({
      input: pullRequestTargetInputSchema,
      output: pullRequestMutationOutputSchema,
      description: `Stop watching one linked GitHub pull request without removing its thread link. The session id defaults to the calling thread. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'pull_request_unwatch', render: renderLink },
    }),
  },
})

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
  forgeSearchItemSchema,
  forgeSearchUnavailableSchema,
  issueStatesInputSchema,
  issueStatesOutputSchema,
  ownedUnwatchInputSchema,
  ownedUnwatchOutputSchema,
  ownedWatchInputSchema,
  ownedWatchListInputSchema,
  ownedWatchListOutputSchema,
  ownedWatchMutationOutputSchema,
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
    search: method({
      input: Schema.Struct({
        cwd: Schema.String.check(Schema.isMinLength(1)),
        query: Schema.String.check(Schema.isMaxLength(100), Schema.isPattern(/^[\p{L}\p{N} _.-]*$/u)),
      }),
      output: Schema.Struct({ items: Schema.Array(forgeSearchItemSchema), unavailable: Schema.optional(forgeSearchUnavailableSchema) }),
      description: 'Search recent issues and pull requests in the current GitHub repository. Read-only.',
      tool: {
        name: 'pull_request_search',
        readOnly: true,
        render: output =>
          output.unavailable === undefined
            ? output.items.map(item => `#${String(item.number)} ${item.title} ${item.url}`).join('\n') || 'No matching issues or pull requests.'
            : `Search unavailable: ${output.unavailable.message}`,
      },
    }),
    link: method({
      input: pullRequestLinkInputSchema,
      output: pullRequestMutationOutputSchema,
      description: `Link a GitHub pull request or GitLab merge request to a DSH thread by URL, or by number and repository cwd. The session id defaults to the calling thread. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'pull_request_link', render: renderLink },
    }),
    unlink: method({
      input: pullRequestTargetInputSchema,
      output: pullRequestRemovalOutputSchema,
      description: `Remove one GitHub pull-request or GitLab merge-request link from a DSH thread. Specify the URL or repository and number; the session id defaults to the calling thread. ${ONLY_WHEN_ASKED}`,
      tool: {
        name: 'pull_request_unlink',
        render: output => `${output.removed ? 'Unlinked' : 'No link found for'} ${output.repo}#${String(output.number)} from thread ${output.sessionId}.`,
      },
    }),
    list: method({
      input: pullRequestListInputSchema,
      output: pullRequestListOutputSchema,
      description:
        'List GitHub pull-request and GitLab merge-request links for one thread (defaults to the calling thread) or across all threads with all: true, including each link’s last known state and whether it is watched. Read-only.',
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
      description: `Start watching a GitHub pull request or GitLab merge request; watching creates the thread link if needed. The session id defaults to the calling thread. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'pull_request_watch', render: renderLink },
    }),
    createPreview: method({
      input: pullRequestCreatePreviewInputSchema,
      output: pullRequestCreatePreviewSchema,
      description:
        'Preview creating a pull request (GitHub) or merge request (GitLab) from a thread’s jj workspace: the repository, base branch, bookmark to push, the commits above the base, a title and body drafted from the thread with its model, an existing open pull request for the bookmark, and every blocking problem with its recovery. Changes nothing (it only reads jj, gh and the thread). Pass its bookmark, base, headCommitId, title and body to pull_request_create. Read-only.',
      tool: { name: 'pull_request_create_preview', readOnly: true, render: renderPreview },
    }),
    create: method({
      input: pullRequestCreateInputSchema,
      output: pullRequestCreateOutputSchema,
      description: `Create a pull request or merge request from a thread’s jj workspace after pull_request_create_preview: sets the bookmark on the previewed head commit, pushes it with jj git push, runs gh pr create or glab mr create (or reuses an open one for the bookmark), then links and watches it on the thread. Requires confirm: true and the preview’s headCommitId; refuses when the workspace moved. Publishes to the forge. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'pull_request_create', render: renderCreate },
    }),
    watchFor: method({
      input: ownedWatchInputSchema,
      output: ownedWatchMutationOutputSchema,
      description:
        'Watch a pull request or merge request for an owner that is not a thread (a backlog item, by its id). The sweep keeps its state current; it never prompts or settles a thread. Idempotent.',
    }),
    unwatchFor: method({
      input: ownedUnwatchInputSchema,
      output: ownedUnwatchOutputSchema,
      description: 'Release an owner’s watch of one pull request, or of all its pull requests when no URL is given. Answers how many watches were released.',
    }),
    ownedWatches: method({
      input: ownedWatchListInputSchema,
      output: ownedWatchListOutputSchema,
      description: 'List every watch held by owners of one kind (backlog items), with each pull request’s last known state and when it was checked. Read-only.',
    }),
    issueStates: method({
      input: issueStatesInputSchema,
      output: issueStatesOutputSchema,
      description:
        'Read the open or closed state of up to 100 GitHub issues by URL, in batched gh api graphql calls. Reports the URLs it could not read and whether GitHub rate-limited the read. Read-only.',
    }),
    unwatch: method({
      input: pullRequestTargetInputSchema,
      output: pullRequestMutationOutputSchema,
      description: `Stop watching one linked pull request or merge request without removing its thread link. The session id defaults to the calling thread. ${ONLY_WHEN_ASKED}`,
      tool: { name: 'pull_request_unwatch', render: renderLink },
    }),
  },
})

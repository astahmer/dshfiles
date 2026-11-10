import type { ApiCaller } from '@dshfiles/dshx/api'
import { Jj, type JjOutput } from '@dshfiles/jj-cli'
import { Context, Duration, Effect, Layer, Option } from 'effect'
import {
  CreateModel,
  type CreateCommit,
  type CreateProblem,
  type PullRequestCreateInput,
  type PullRequestCreateOutput,
  type PullRequestCreatePreview,
  type PullRequestCreatePreviewInput,
} from './create-model.js'
import { GitHubCli, type GitHubRepositoryInfo } from './github-cli.js'
import { cwdForCaller, PullRequestMonitor, sessionFor, type PullRequestMonitorError } from './monitor.js'
import { ProjectBase } from './project-base.js'
import type { PullRequestRecord } from './pull-request-model.js'
import { ThreadContext } from './thread-context.js'

type JjResult = { readonly kind: 'ok'; readonly output: JjOutput } | { readonly kind: 'problem'; readonly problem: CreateProblem }

const NOT_A_REPOSITORY = /no jj repo|not a jj repo|there is no jj repo/iu
const firstLine = (text: string): string =>
  text
    .split('\n')
    .map(line => line.replace(/^(Error|Hint):\s*/u, '').trim())
    .find(line => line.length > 0) ?? ''

/** A revset string literal for a bookmark or remote name we already validated. */
const quoted = (name: string): string => JSON.stringify(name)

interface Workspace {
  readonly remote: string
  readonly base: string
  readonly headCommitId: string | null
  readonly commits: readonly CreateCommit[]
  readonly existingBookmark: string | null
}

const pushRecovery = (stderr: string): string => {
  if (/stale|rejected|fetch first|non-fast-forward|moved unexpectedly/iu.test(stderr))
    return 'The remote branch changed. Run `jj git fetch`, rebase the thread onto it, then retry.'
  if (/no description/iu.test(stderr)) return 'Describe every commit with `jj describe -m "<message>"`, then retry.'
  if (/conflict/iu.test(stderr)) return 'Resolve the conflicts with `jj resolve`, then retry.'
  if (/permission|denied|authenticat|credential|403/iu.test(stderr))
    return 'Git could not authenticate to the remote. Check `git push` works from this workspace (SSH key or `gh auth setup-git`), then retry.'
  return 'Run `jj git push --bookmark <name>` in the workspace to see the full error, fix it, then retry.'
}

/** Creates a pull request from a thread's jj workspace: preview first, then push and `gh pr create` on explicit confirm. */
export class PullRequestCreator extends Context.Service<
  PullRequestCreator,
  {
    readonly preview: (input: PullRequestCreatePreviewInput, caller: ApiCaller) => Effect.Effect<PullRequestCreatePreview, PullRequestMonitorError>
    readonly create: (input: PullRequestCreateInput, caller: ApiCaller) => Effect.Effect<PullRequestCreateOutput, PullRequestMonitorError>
  }
>()('@dshfiles/pull-requests/PullRequestCreator') {
  static readonly layer = Layer.effect(
    PullRequestCreator,
    Effect.gen(function* () {
      const jj = yield* Jj
      const github = yield* GitHubCli
      const thread = yield* ThreadContext
      const monitor = yield* PullRequestMonitor
      const projectBase = yield* ProjectBase

      const runJj = (args: readonly string[], cwd: string, timeoutSeconds = 30): Effect.Effect<JjResult> =>
        jj.run({ args, cwd, timeout: Duration.seconds(timeoutSeconds) }).pipe(
          Effect.map((output): JjResult => {
            if (output.exitCode === 0) return { kind: 'ok', output }
            if (NOT_A_REPOSITORY.test(output.stderr))
              return { kind: 'problem', problem: CreateModel.problem('not-a-jj-repository', `${cwd} is not a jj workspace.`) }
            return { kind: 'ok', output }
          }),
          Effect.catch(error =>
            Effect.succeed<JjResult>(
              error._tag === 'JjSpawnFailed' && error.reason === 'executable-not-found'
                ? { kind: 'problem', problem: CreateModel.problem('jj-missing', 'The jj executable was not found on the DSH Host PATH.') }
                : { kind: 'problem', problem: CreateModel.problem('not-a-jj-repository', error.message) },
            ),
          ),
        )

      /** gh availability and the GitHub repository, as problems instead of failures. */
      const checkGitHub = Effect.fn('pull-requests create gh check')(function* (cwd: string) {
        const auth = yield* github.authStatus.pipe(Effect.result)
        if (auth._tag === 'Failure') {
          const missing = auth.failure.missing === true
          return {
            repository: null,
            problems: [
              missing
                ? CreateModel.problem('gh-missing', 'The GitHub CLI (gh) is not installed on the DSH Host.')
                : CreateModel.problem('gh-unauthenticated', 'The GitHub CLI is not signed in to github.com.'),
            ],
          }
        }
        const info = yield* github.repositoryInfo({ cwd }).pipe(Effect.option)
        if (Option.isNone(info))
          return { repository: null, problems: [CreateModel.problem('repository-unknown', `gh could not find a GitHub repository for ${cwd}.`)] }
        return { repository: info.value, problems: [] }
      })

      /** Remote, base, head commit and the commits a push would publish. */
      const readWorkspace = Effect.fn('pull-requests create workspace')(function* (cwd: string, repository: GitHubRepositoryInfo | null) {
        const problems: CreateProblem[] = []
        const remotes = yield* runJj(['git', 'remote', 'list'], cwd)
        if (remotes.kind === 'problem') return { workspace: undefined, problems: [remotes.problem] }
        const names = remotes.output.stdout
          .split('\n')
          .map(line => line.trim().split(/\s+/u)[0] ?? '')
          .filter(name => name.length > 0)
        const remote = names.includes('origin') ? 'origin' : names[0]
        if (remote === undefined) return { workspace: undefined, problems: [CreateModel.problem('no-remote', 'The workspace has no Git remote to push to.')] }

        const base = (yield* projectBase.chosenFor(cwd)) ?? repository?.defaultBranch ?? 'main'
        const baseRef = `${quoted(base)}@${quoted(remote)}`
        const baseFound = yield* runJj(['log', '--no-graph', '-r', `present(${baseRef})`, '-T', 'commit_id'], cwd)
        if (baseFound.kind === 'problem') return { workspace: undefined, problems: [baseFound.problem] }
        if (baseFound.output.stdout.trim().length === 0) {
          problems.push(CreateModel.problem('base-missing', `The base branch ${base}@${remote} is not known locally.`))
          return { workspace: { remote, base, headCommitId: null, commits: [], existingBookmark: null }, problems }
        }

        const working = yield* runJj(['log', '--no-graph', '-r', '@', '-T', 'if(empty && description == "", "empty", "content")'], cwd)
        if (working.kind === 'problem') return { workspace: undefined, problems: [working.problem] }
        const head = working.output.stdout.trim() === 'empty' ? '@-' : '@'
        const listed = yield* runJj(['log', '--no-graph', '-r', `${baseRef}..${head}`, '-T', CreateModel.COMMIT_TEMPLATE], cwd)
        if (listed.kind === 'problem') return { workspace: undefined, problems: [listed.problem] }
        const commits = CreateModel.parseCommitLines(listed.output.stdout)
        if (commits.length === 0) {
          problems.push(CreateModel.problem('no-commits', `Nothing above ${base}@${remote} to push.`))
          return { workspace: { remote, base, headCommitId: null, commits, existingBookmark: null }, problems }
        }
        const undescribed = commits.filter(commit => !commit.described)
        if (undescribed.length > 0)
          problems.push(
            CreateModel.problem(
              'undescribed-commits',
              `${String(undescribed.length)} commit(s) have no description: ${undescribed.map(c => c.changeId).join(', ')}.`,
            ),
          )
        const conflicted = commits.filter(commit => commit.conflicted)
        if (conflicted.length > 0)
          problems.push(
            CreateModel.problem('conflicted-commits', `${String(conflicted.length)} commit(s) are conflicted: ${conflicted.map(c => c.changeId).join(', ')}.`),
          )

        const headCommitId = commits[0]?.commitId ?? null
        const bookmarks = yield* runJj(['log', '--no-graph', '-r', head, '-T', 'local_bookmarks.map(|b| b.name()).join("\\n")'], cwd)
        const existingBookmark =
          bookmarks.kind === 'ok'
            ? (bookmarks.output.stdout
                .split('\n')
                .map(name => name.trim())
                .find(name => name.length > 0 && name !== base) ?? null)
            : null
        return { workspace: { remote, base, headCommitId, commits, existingBookmark } satisfies Workspace, problems }
      })

      const generate = Effect.fn('pull-requests create generate')(function* (input: {
        readonly sessionId: string
        readonly threadTitle: string
        readonly messages: readonly { readonly role: 'user' | 'assistant'; readonly text: string }[]
        readonly commits: readonly CreateCommit[]
        readonly route: { readonly provider: string; readonly model: string } | undefined
      }) {
        const fallback = CreateModel.fallbackPullRequest({ threadTitle: input.threadTitle, commits: input.commits })
        if (input.commits.length === 0) return { ...fallback, generation: { source: 'fallback' as const, note: 'No commits to describe yet.' } }
        if (!thread.canGenerate)
          return { ...fallback, generation: { source: 'fallback' as const, note: 'The Host has no language-model service; drafted from the commit messages.' } }
        if (input.route === undefined)
          return {
            ...fallback,
            generation: {
              source: 'fallback' as const,
              note: 'The thread has no model route yet; drafted from the commit messages. Pass provider and model to generate.',
            },
          }
        const answer = yield* thread
          .complete({
            ...input.route,
            sessionId: input.sessionId,
            system: CreateModel.GENERATION_SYSTEM_PROMPT,
            input: CreateModel.generationInput({ threadTitle: input.threadTitle, messages: input.messages, commits: input.commits }),
          })
          .pipe(Effect.timeout('60 seconds'), Effect.option)
        const parsed = Option.isSome(answer) ? CreateModel.parseGeneratedPullRequest(answer.value) : undefined
        if (parsed === undefined)
          return {
            ...fallback,
            generation: {
              source: 'fallback' as const,
              note: `${input.route.provider}/${input.route.model} did not return a usable draft; drafted from the commit messages. Edit it, or retry the preview.`,
            },
          }
        return { ...parsed, generation: { source: 'model' as const, note: `${input.route.provider}/${input.route.model}` } }
      })

      const preview = Effect.fn('pull-requests create preview')(function* (input: PullRequestCreatePreviewInput, caller: ApiCaller) {
        const sessionId = yield* sessionFor(input.sessionId, caller)
        const snapshot = yield* thread.read(sessionId)
        const cwd = input.cwd ?? snapshot.cwd ?? (cwdForCaller(caller) || undefined)
        const blank = {
          sessionId,
          repo: null,
          remote: null,
          base: null,
          bookmark: null,
          bookmarkExists: false,
          headCommitId: null,
          commits: [],
          existingUrl: null,
        }
        if (cwd === undefined)
          return {
            ...blank,
            status: 'blocked',
            cwd: '',
            title: '',
            body: '',
            generation: { source: 'fallback', note: 'No workspace.' },
            problems: [CreateModel.problem('no-session-cwd', 'This thread has no working directory.')],
          } satisfies PullRequestCreatePreview

        const gh = yield* checkGitHub(cwd)
        const read = yield* readWorkspace(cwd, gh.repository)
        const workspace = read.workspace
        const commits = workspace?.commits ?? []
        const draft = yield* generate({
          sessionId,
          threadTitle: snapshot.title,
          messages: snapshot.messages,
          commits,
          route: input.provider !== undefined && input.model !== undefined ? { provider: input.provider, model: input.model } : snapshot.route,
        })
        const head = commits[0]
        const bookmark =
          workspace === undefined || head === undefined
            ? null
            : (workspace.existingBookmark ?? CreateModel.bookmarkFromTitle(snapshot.title.length > 0 ? snapshot.title : head.summary, head.changeId))
        const existingUrl =
          gh.repository !== null && bookmark !== null
            ? yield* github.openPullRequestFor({ repo: gh.repository.repo, cwd, head: bookmark }).pipe(Effect.orElseSucceed(() => null))
            : null
        const problems = [...gh.problems, ...read.problems]
        return {
          status: problems.length === 0 ? 'ready' : 'blocked',
          sessionId,
          cwd,
          repo: gh.repository?.repo ?? null,
          remote: workspace?.remote ?? null,
          base: workspace?.base ?? null,
          bookmark,
          bookmarkExists: workspace?.existingBookmark !== null && workspace?.existingBookmark !== undefined,
          headCommitId: workspace?.headCommitId ?? null,
          commits,
          title: draft.title,
          body: draft.body,
          generation: draft.generation,
          existingUrl,
          problems,
        } satisfies PullRequestCreatePreview
      })

      const failed = (
        stage: Extract<PullRequestCreateOutput, { status: 'failed' }>['stage'],
        message: string,
        recovery: string,
        options: { readonly problems?: readonly CreateProblem[]; readonly pushed?: boolean } = {},
      ): PullRequestCreateOutput => ({ status: 'failed', stage, message, recovery, problems: options.problems ?? [], pushed: options.pushed ?? false })

      const linkCreated = (input: { readonly sessionId: string; readonly url: string; readonly cwd: string; readonly watch: boolean }, caller: ApiCaller) =>
        (input.watch
          ? monitor.watch({ sessionId: input.sessionId, url: input.url, cwd: input.cwd }, caller)
          : monitor.link({ sessionId: input.sessionId, url: input.url, cwd: input.cwd }, caller)
        ).pipe(Effect.result)

      const create = Effect.fn('pull-requests create')(function* (input: PullRequestCreateInput, caller: ApiCaller) {
        const sessionId = yield* sessionFor(input.sessionId, caller)
        const snapshot = yield* thread.read(sessionId)
        const cwd = input.cwd ?? snapshot.cwd ?? (cwdForCaller(caller) || undefined)
        if (cwd === undefined) {
          const missing = CreateModel.problem('no-session-cwd', 'This thread has no working directory.')
          return failed('preflight', missing.message, missing.recovery, { problems: [missing] })
        }
        const gh = yield* checkGitHub(cwd)
        const read = yield* readWorkspace(cwd, gh.repository)
        const problems = [...gh.problems, ...read.problems]
        const first = problems[0]
        if (first !== undefined || gh.repository === null || read.workspace === undefined)
          return failed('preflight', first?.message ?? 'The workspace is not ready to push.', first?.recovery ?? 'Run the preview again.', { problems })
        const workspace = read.workspace
        if (workspace.headCommitId !== input.headCommitId)
          return failed(
            'preflight',
            'The workspace changed since the preview: its head commit is no longer the one you confirmed.',
            'Run the preview again and confirm the new commits.',
          )

        const set = yield* runJj(['bookmark', 'set', input.bookmark, '-r', input.headCommitId], cwd)
        if (set.kind === 'problem') return failed('bookmark', set.problem.message, set.problem.recovery)
        if (set.output.exitCode !== 0)
          return failed(
            'bookmark',
            `jj could not point ${input.bookmark} at the head commit: ${firstLine(set.output.stderr)}`,
            /backwards|sideways/iu.test(set.output.stderr)
              ? `The bookmark ${input.bookmark} already points elsewhere. Choose another bookmark name, or move it yourself with \`jj bookmark set ${input.bookmark} -r ${input.headCommitId.slice(0, 12)} --allow-backwards\`.`
              : 'Check the bookmark name and run `jj bookmark list`, then retry.',
          )

        const pushed = yield* runJj(['git', 'push', '--remote', workspace.remote, '--bookmark', input.bookmark], cwd, 120)
        if (pushed.kind === 'problem') return failed('push', pushed.problem.message, pushed.problem.recovery)
        if (pushed.output.exitCode !== 0) return failed('push', `jj git push failed: ${firstLine(pushed.output.stderr)}`, pushRecovery(pushed.output.stderr))

        const existing = yield* github.openPullRequestFor({ repo: gh.repository.repo, cwd, head: input.bookmark }).pipe(Effect.orElseSucceed(() => null))
        let url = existing
        if (url === null) {
          const created = yield* github
            .createPullRequest({
              repo: gh.repository.repo,
              cwd,
              head: input.bookmark,
              base: input.base,
              title: input.title,
              body: input.body,
              draft: input.draft === true,
            })
            .pipe(Effect.result)
          if (created._tag === 'Failure')
            return failed(
              'gh-create',
              created.failure.message,
              `The branch ${input.bookmark} is pushed. Retry, or open the pull request on GitHub and link it with pull_request_link.`,
              { pushed: true },
            )
          url = created.success
        }

        const linked = yield* linkCreated({ sessionId, url, cwd, watch: input.watch !== false }, caller)
        if (linked._tag === 'Failure')
          return failed(
            'link',
            `The pull request ${url} was created but could not be linked: ${linked.failure.message}`,
            `Link it with pull_request_link ${url}.`,
            {
              pushed: true,
            },
          )
        return { status: 'created', opened: existing === null, url, link: viewOf(linked.success) } satisfies PullRequestCreateOutput
      })

      return PullRequestCreator.of({ preview, create })
    }),
  )
}

const viewOf = (record: PullRequestRecord) => ({
  sessionId: record.sessionId,
  repo: record.repo,
  number: record.number,
  url: record.url,
  watching: record.watching,
  lastKnownState: record.lastKnownState,
  lastCheckedAt: record.lastCheckedAt,
  lastError: record.lastError,
})

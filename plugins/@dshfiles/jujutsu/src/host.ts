import { Jj, JjViewReads } from '@dshfiles/jj-cli'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { definePromptSection } from '@dshfiles/dshx/host'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { jujutsuApi, type ReadFailure } from './api.js'
import { composerContextApi } from './composer-context-api.js'
import { ComposerContext } from './composer-context-host.js'
import type { ReadError } from './errors.js'
import { JujutsuServicesLive } from './jujutsu-services.js'
import { Mutations } from './mutations.js'
import { Repositories } from './repositories.js'
import { registerRepositoryBatch } from './repository-batch.js'
import { jujutsuReviewProgressApi } from './review-progress-api.js'
import { ReviewProgress } from './review-progress-host.js'
import { RevisionReader } from './revision-reader.js'
import { jujutsuSettings } from './settings.js'

const PlatformLive = Layer.mergeAll(DshChildProcessSpawner.layer, NodeFileSystem.layer, NodePath.layer, StorageDomain.layer)

const JujutsuLive = Layer.mergeAll(JujutsuServicesLive, ReviewProgress.layer).pipe(
  Layer.provideMerge(JjViewReads.layer),
  Layer.provideMerge(Jj.layer),
  Layer.provideMerge(PlatformLive),
)

/** Read endpoints answer a failure as a value: a user-written message, or their generic one for an unreadable record. */
const asReadFailure =
  (fallback: string) =>
  <A, R>(effect: Effect.Effect<A, ReadError, R>): Effect.Effect<A | ReadFailure, never, R> =>
    effect.pipe(
      Effect.catchTag('InvalidJjOutput', () => Effect.succeed({ failure: { message: fallback } })),
      Effect.catch(error => Effect.succeed({ failure: { message: error.message.slice(0, 500) } })),
    )

// An unreadable jj record is a Host defect outside the read endpoints: the caller reads the generic failure.
const jujutsuHandlers = Api.handlers(jujutsuApi, {
  openRepository: input =>
    Repositories.use(repositories => repositories.open(input.path)).pipe(
      Effect.map(opened => ({ repoId: opened.repo.id, root: opened.repo.root, initialized: opened.initialized })),
    ),
  registerRepository: input =>
    Repositories.use(repositories => repositories.register(input.path)).pipe(Effect.map(repo => ({ repoId: repo.id, root: repo.root }))),
  registerRepositories: input =>
    Repositories.use(repositories =>
      registerRepositoryBatch({
        paths: input.paths,
        register: path => repositories.register(path).pipe(Effect.map(repo => ({ repoId: repo.id, root: repo.root }))),
      }),
    ).pipe(Effect.map(repositories => ({ repositories: [...repositories] }))),
  workspaces: input =>
    Repositories.use(repositories => Effect.flatMap(repositories.resolve(input.repoId), repositories.workspaces)).pipe(
      Effect.map(workspaces => ({ workspaces: [...workspaces] })),
    ),
  load: input => RevisionReader.use(reader => reader.load(input)).pipe(asReadFailure('Could not load this repository.')),
  graphPage: input => RevisionReader.use(reader => reader.graphPage(input)).pipe(asReadFailure('Could not read the next revision graph page.')),
  graphNavigation: input => RevisionReader.use(reader => reader.graphNavigation(input.repoId)).pipe(asReadFailure('Could not resolve graph landmarks.')),
  revisionRelationship: input => RevisionReader.use(reader => reader.relationship(input)).pipe(asReadFailure('Could not compare revisions.')),
  graphSlice: input => RevisionReader.use(reader => reader.slice(input)).pipe(asReadFailure('Could not read revision history.')),
  referenceGraph: input => RevisionReader.use(reader => reader.referenceGraph(input)).pipe(asReadFailure('Could not read a graph around that reference.')),
  referenceTitles: input =>
    RevisionReader.use(reader => reader.referenceTitles(input)).pipe(Effect.map(output => ({ titles: [...output.titles] }))),
  details: input => RevisionReader.use(reader => reader.details(input)).pipe(asReadFailure('Could not load revision details.')),
  revisionFiles: input => RevisionReader.use(reader => reader.fileStats(input)).pipe(Effect.catchTag('InvalidJjOutput', Effect.die)),
  editTimes: input =>
    RevisionReader.use(reader => reader.editTimes(input)).pipe(
      Effect.map(revisions => ({ revisions })),
      Effect.catchTag('InvalidJjOutput', Effect.die),
    ),
  workingDiff: input => RevisionReader.use(reader => reader.workingDiff(input.repoId)),
  prepare: input => Mutations.use(mutations => mutations.prepare(input)).pipe(Effect.catchTag('InvalidJjOutput', Effect.die)),
  confirm: input => Mutations.use(mutations => mutations.confirm(input)).pipe(Effect.catchTag('InvalidJjOutput', Effect.die)),
})

const composerHandlers = Api.handlers(composerContextApi, {
  context: input => ComposerContext.use(composer => composer.context(input)).pipe(Effect.catchTag('InvalidJjOutput', Effect.die)),
  diff: input => ComposerContext.use(composer => composer.diff(input)),
})

const reviewProgressHandlers = Api.handlers(jujutsuReviewProgressApi, {
  state: () => ReviewProgress.use(reviews => reviews.snapshot()),
  toggle: input => ReviewProgress.use(reviews => reviews.toggle(input)),
})

/**
 * One writing convention for every Agent in this DSH: an explicit revision or bookmark reference is written
 * `jj:<name>`, which the client links to the panel and shows the revision description when available.
 */
const chatReferenceSection = definePromptSection({
  name: 'dshfiles-jujutsu:chat-references',
  order: 900,
  text: [
    'In chat, write a Jujutsu revision, change or bookmark reference as `jj:<name>` inside inline code — for example',
    '`jj:main`, `jj:94526da8` or `jj:feature/topic`. DSH turns such a token into a link that opens the Jujutsu panel on',
    'that revision, and shows the revision title as link text when available, falling back to the bare name.',
  ].join(' '),
})

export default {
  ...DshxPlugin.make({
    name: '@dshfiles/jujutsu',
    inject: ['subprocess', 'webServer', 'storageDomain'],
    settings: [jujutsuSettings],
    layer: JujutsuLive,
    apis: [Api.bind(jujutsuApi, jujutsuHandlers), Api.bind(jujutsuReviewProgressApi, reviewProgressHandlers), Api.bind(composerContextApi, composerHandlers)],
  }),
  prompts: [chatReferenceSection],
}

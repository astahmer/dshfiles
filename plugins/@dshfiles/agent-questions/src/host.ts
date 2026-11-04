import { DshxPlugin } from '@dshfiles/dshx/effect'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Layer } from 'effect'
import { AgentDirectory, NativeQuestions, QuestionFactsLive } from './agent-host-promise.js'
import { DeferredQuestionFiles } from './deferred-question-files.js'
import { MarkdownDocuments } from './markdown-documents.js'
import { ParentFeedback } from './parent-feedback.js'
import { ParentQuestions } from './parent-questions.js'
import { QuestionScan } from './question-scan.js'
import { QuestionStore } from './question-store.js'
import { agentQuestionTools } from './tools.js'

const WorkspaceFilesLive = Layer.mergeAll(MarkdownDocuments.layer, DeferredQuestionFiles.layer).pipe(
  Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
)

const HostEdgeLive = Layer.mergeAll(
  AgentDirectory.layer,
  NativeQuestions.layer,
  QuestionFactsLive,
  QuestionStore.layer.pipe(Layer.provide(StorageDomain.layer)),
)

const AgentQuestionsLive = Layer.mergeAll(ParentQuestions.layer, ParentFeedback.layer, QuestionScan.layer).pipe(
  Layer.provideMerge(Layer.mergeAll(WorkspaceFilesLive, HostEdgeLive)),
)

export default DshxPlugin.make({
  name: 'agent-questions',
  inject: ['agents', 'sessions', 'sessionProjections', 'sessionQuery', 'subagents', 'storageDomain', 'userQuestions'],
  layer: AgentQuestionsLive,
  tools: agentQuestionTools,
})

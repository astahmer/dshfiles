import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const packageName = '@dshfiles/agent-questions-cold-resume-fixture'
const parentProvider = 'agent-questions-scratch-parent'
const childProvider = 'agent-questions-scratch-child'
const continuationProvider = 'agent-questions-scratch-continuation'

const readJson = async path => {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

const writeJson = async (path, value, home) => {
  const temporaryPath = path + '.tmp'
  await writeFile(temporaryPath, JSON.stringify(value, null, 2).replaceAll(home, '[scratch-home]'))
  await rename(temporaryPath, path)
}

const waitForIdle = async (agent, label) => {
  let timer
  try {
    await Promise.race([
      agent.whenIdle(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ' did not become idle.')), 15_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

const waitForProviderCalls = async (path, provider, expected) => {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const calls = (await readJson(path))?.[provider] ?? 0
    if (calls >= expected) return calls
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50))
  }
  throw new Error('The scratch provider did not receive the expected turn.')
}

const executeTool = (context, { agent, name, args, callId = randomUUID() }) =>
  context.tools.execute({ signal: new AbortController().signal, callId, name, arguments: args, agent })

const requireToolSuccess = (result, label) => {
  if (result.isError) throw new Error(label + ' failed: ' + JSON.stringify(result))
  return String(result.value)
}

const feedbackIdFrom = (result, label) => {
  const text = requireToolSuccess(result, label)
  const match = text.match(/^Feedback ([^\s]+) was sent to the direct parent/)
  if (match === null) throw new Error(label + ' did not return a feedback id: ' + text)
  return match[1]
}

export const name = packageName
export const inject = ['agents', 'llm', 'parentFeedback', 'parentQuestions', 'subagents', 'tools']
export const apply = async context => {
  const home = process.env.DSH_HOME
  if (home === undefined) throw new Error('The scratch DSH_HOME is unavailable.')

  const projectPath = resolve(home, 'agent-questions-project')
  const statePath = resolve(home, 'agent-questions-cold-resume-state.json')
  const resultPath = resolve(home, 'agent-questions-cold-resume-result.json')
  const callCountPath = resolve(home, 'agent-questions-cold-resume-calls.json')
  let releaseFirstChildTurn = () => {}
  const firstChildTurnGate = new Promise(resolveGate => {
    releaseFirstChildTurn = resolveGate
  })
  const incrementCallCount = async provider => {
    const counts = (await readJson(callCountPath)) ?? {}
    const callCount = (counts[provider] ?? 0) + 1
    await writeJson(callCountPath, { ...counts, [provider]: callCount }, home)
    return callCount
  }
  const adapter = {
    providerInfo: provider => ({ id: provider, name: provider }),
    providerRetryPolicy: () => undefined,
    imageRequestPricing: () => undefined,
    resolveModel: async (provider, model) => ({ provider, id: model, name: model }),
    prepareCall: async (provider, model) => ({
      model: { provider, id: model, name: model },
      stream: options => adapter.stream(options),
    }),
    async *stream(options) {
      const callCount = await incrementCallCount(options.provider)
      if (options.provider === childProvider && callCount === 1) await firstChildTurnGate
      const text = options.provider + '-response-' + String(callCount)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: text.length } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  const disposeAdapter = context.llm.registerAdapter([parentProvider, childProvider], adapter)
  const continuation = {
    name: continuationProvider,
    capabilities: {
      agentOptions: true,
      outputSchema: false,
      depthLimit: false,
      toolFilter: false,
      persona: false,
    },
    inheritsParentContext: false,
    start: async () => {
      throw new Error('The scratch fixture only creates continuable children.')
    },
    prepareContinuable: async () => ({}),
  }
  const disposeContinuation = context.subagents.registerProvider(continuation)

  try {
    const state = await readJson(statePath)
    if (state === undefined) {
      const parentHandle = await context.agents.create({
        sessionId: randomUUID(),
        meta: { cwd: projectPath },
        agentOptions: { provider: parentProvider, model: 'fixture' },
      })
      const parent = parentHandle.agent
      const started = await context.subagents.startContinuable({
        provider: continuationProvider,
        label: 'Agent Questions cold-resume acceptance',
        request: {
          parent,
          prompt: [{ type: 'text', text: 'Initialize the scratch feedback child.' }],
          agentOptions: { provider: childProvider, model: 'fixture' },
        },
        signal: new AbortController().signal,
      })
      const child = context.agents.get(started.childId)
      if (child === undefined) throw new Error('The continuable child was not published.')
      if (context.agents.get(parent.id) !== parent || !context.agents.isOwnedBy(child.id, parent)) {
        throw new Error('The scratch child was not attached to the exact live parent.')
      }
      if (child.session.header.cwd !== projectPath) throw new Error('The child did not inherit the isolated scratch workspace.')
      const initialCalls = await waitForProviderCalls(callCountPath, childProvider, 1)
      if (initialCalls !== 1) throw new Error('The initial child turn did not reach the scratch provider exactly once.')

      const questionOperationId = randomUUID()
      const questionInput = {
        question: 'Choose a harmless scratch-test outcome.',
        context: 'This verifies Host tool access to the question service.',
        options: [
          { id: 'recommended', label: 'Use the recommendation', description: 'Default demonstration choice.' },
          { id: 'alternate', label: 'Use the alternate choice' },
        ],
        recommendedOptionId: 'recommended',
        expiryBehavior: 'recommended',
        timeoutMs: 10_000,
      }
      const questionReceipt = await context.parentQuestions.request({
        agent: child,
        operationId: questionOperationId,
        ...questionInput,
        signal: new AbortController().signal,
      })
      const unauthorizedAnswer = await executeTool(context, {
        agent: child,
        name: 'answer_parent_question',
        args: { questionId: questionReceipt.questionId, answer: 'The child cannot answer itself.' },
      })
      if (!unauthorizedAnswer.isError) throw new Error('A child incorrectly answered its own parent question.')
      const childQuestionWait = executeTool(context, {
        agent: child,
        name: 'ask_parent_question',
        args: questionInput,
        callId: questionOperationId,
      })
      const parentQuestionAnswer = await executeTool(context, {
        agent: parent,
        name: 'answer_parent_question',
        args: { questionId: questionReceipt.questionId, answer: 'Use the alternate choice.' },
      })
      const childQuestionResult = await childQuestionWait
      if (parentQuestionAnswer.isError || childQuestionResult.isError || !String(childQuestionResult.value).includes('Use the alternate choice.')) {
        throw new Error('The Agent Questions Host tools did not complete a child question and parent answer.')
      }

      const reattachQuestion = await context.parentQuestions.request({
        agent: child,
        operationId: 'cold-resume-question',
        question: 'What should happen after the Host restarts?',
        context: 'Reattach to this question using its durable id.',
        options: [
          { id: 'resume', label: 'Resume the pending decision' },
          { id: 'defer', label: 'Defer the pending decision' },
        ],
        recommendedOptionId: 'resume',
        expiryBehavior: 'recommended',
        timeoutMs: 120_000,
        signal: new AbortController().signal,
      })
      const recommendedResult = await executeTool(context, {
        agent: child,
        name: 'ask_parent_question',
        args: {
          question: 'Which safe result should expiry select?',
          context: 'Verify recommended expiry through the real Host tool.',
          options: [
            { id: 'keep-safe', label: 'Keep the safe choice', description: 'Never choose the destructive alternative.' },
            { id: 'destructive', label: 'Run the destructive alternative' },
          ],
          recommendedOptionId: 'keep-safe',
          expiryBehavior: 'recommended',
          timeoutMs: 1_000,
        },
      })
      const recommendedText = requireToolSuccess(recommendedResult, 'Recommended question expiry')
      if (!recommendedText.includes('Using recommended option keep-safe: Keep the safe choice.')) {
        throw new Error('Question expiry did not select the recommended option.')
      }
      const deferredResult = await executeTool(context, {
        agent: child,
        name: 'ask_parent_question',
        args: {
          question: 'What should be reviewed later?',
          context: 'Verify private deferred question files through the real Host tool.',
          options: [
            { id: 'review', label: 'Review before acting' },
            { id: 'skip', label: 'Skip the later review' },
          ],
          recommendedOptionId: 'review',
          expiryBehavior: 'defer',
          timeoutMs: 1_000,
        },
      })
      const deferredText = requireToolSuccess(deferredResult, 'Deferred question expiry')
      const deferredFilePath = deferredText.match(/questions\/[^\s]+?\.md(?=[\s.])/)?.[0]
      if (deferredFilePath === undefined || !deferredText.includes('this file does not send an answer')) {
        throw new Error('Question expiry did not report its deferred file without inventing an answer.')
      }
      const deferredFile = await readFile(resolve(projectPath, deferredFilePath), 'utf8')
      if (!deferredFile.includes('What should be reviewed later?')) throw new Error('The deferred question file omitted the question text.')

      const currentFeedbackInput = {
        path: 'review.md',
        startLine: 1,
        endLine: 1,
        selectedText: '# Cold-resume target',
        comment: 'Confirm this synthetic feedback target.',
      }
      const currentFeedbackCallId = 'current-feedback'
      const currentFeedbackResult = await executeTool(context, {
        agent: child,
        name: 'submit_markdown_feedback',
        args: currentFeedbackInput,
        callId: currentFeedbackCallId,
      })
      const currentFeedbackId = feedbackIdFrom(currentFeedbackResult, 'Markdown feedback submission')
      const duplicateFeedbackResult = await executeTool(context, {
        agent: child,
        name: 'submit_markdown_feedback',
        args: currentFeedbackInput,
        callId: currentFeedbackCallId,
      })
      if (feedbackIdFrom(duplicateFeedbackResult, 'Idempotent feedback submission') !== currentFeedbackId) {
        throw new Error('A duplicate feedback operation returned a different id.')
      }

      const staleFeedbackId = feedbackIdFrom(
        await executeTool(context, {
          agent: child,
          name: 'submit_markdown_feedback',
          args: {
            path: 'review-stale.md',
            startLine: 1,
            endLine: 1,
            selectedText: '# Stale target',
            comment: 'This anchor will change before resolution.',
          },
        }),
        'Stale-anchor feedback submission',
      )
      await writeFile(resolve(projectPath, 'review-stale.md'), '# Changed target\nThe previous excerpt is no longer current.\n')

      const cancelledFeedbackId = feedbackIdFrom(
        await executeTool(context, {
          agent: child,
          name: 'submit_markdown_feedback',
          args: {
            path: 'review-cancel.md',
            startLine: 1,
            endLine: 1,
            selectedText: '# Cancel target',
            comment: 'This request will be cancelled by its owner.',
          },
        }),
        'Cancellable feedback submission',
      )
      const cancellation = await executeTool(context, {
        agent: child,
        name: 'cancel_parent_feedback',
        args: { feedbackId: cancelledFeedbackId },
      })
      if (!requireToolSuccess(cancellation, 'Feedback cancellation').includes('is cancelled.')) {
        throw new Error('The child could not cancel its own pending feedback.')
      }
      const unsafeFeedback = await executeTool(context, {
        agent: child,
        name: 'submit_markdown_feedback',
        args: { ...currentFeedbackInput, path: '../outside.md' },
      })
      if (!unsafeFeedback.isError) throw new Error('Markdown feedback accepted a path outside the child workspace.')

      const coldResumeFeedbackId = feedbackIdFrom(
        await executeTool(context, {
          agent: child,
          name: 'submit_markdown_feedback',
          args: { ...currentFeedbackInput, comment: 'Resolve this after Host restart.' },
          callId: 'cold-resume-feedback',
        }),
        'Cold-resume feedback submission',
      )
      const pendingRead = await executeTool(context, {
        agent: child,
        name: 'get_parent_feedback',
        args: { feedbackId: coldResumeFeedbackId },
      })
      if (!requireToolSuccess(pendingRead, 'Pending feedback retrieval').includes('is still pending')) {
        throw new Error('The child did not read its pending feedback status.')
      }
      const oversizedBatch = await executeTool(context, {
        agent: parent,
        name: 'resolve_parent_feedback',
        args: {
          responses: [
            { feedbackId: coldResumeFeedbackId, disposition: 'accepted' },
            ...Array.from({ length: 20 }, (_, index) => ({ feedbackId: 'missing-' + String(index), disposition: 'accepted' })),
          ],
        },
      })
      if (!oversizedBatch.isError) throw new Error('The Host accepted a feedback batch larger than twenty items.')

      releaseFirstChildTurn()
      await waitForIdle(child, 'The initial provider-backed child turn')
      await waitForIdle(parent, 'The parent notification turns')

      await writeJson(
        statePath,
        {
          phase: 'pending',
          parentSessionId: parent.id,
          childSessionId: child.id,
          feedbackId: coldResumeFeedbackId,
          currentFeedbackId,
          staleFeedbackId,
          cancelledFeedbackId,
          questionId: reattachQuestion.questionId,
          childProviderCalls: initialCalls,
          parentQuestionToolPassed: true,
          expiryRecommendedPassed: true,
          expiryDeferredPassed: true,
          feedbackToolsPassed: true,
          oversizedBatchRejected: true,
        },
        home,
      )
      return
    }

    if (state.phase !== 'pending') throw new Error('The scratch feedback state has an unsupported phase.')
    if (
      state.parentQuestionToolPassed !== true ||
      state.expiryRecommendedPassed !== true ||
      state.expiryDeferredPassed !== true ||
      state.feedbackToolsPassed !== true ||
      state.oversizedBatchRejected !== true
    ) {
      throw new Error('The first Host boot did not verify every question and feedback tool path.')
    }
    if (context.agents.get(state.childSessionId) !== undefined) {
      throw new Error('The child was already resident at the second Host boot.')
    }

    const parentHandle = await context.agents.resume({
      resumeSessionId: state.parentSessionId,
      agentOptions: { provider: parentProvider, model: 'fixture' },
    })
    const parent = parentHandle.agent
    const [resolution] = await context.parentFeedback.answerMany({
      agent: parent,
      responses: [{ feedbackId: state.feedbackId, disposition: 'accepted', note: 'Accepted after cold resume.' }],
      signal: new AbortController().signal,
    })
    const child = context.agents.get(state.childSessionId)
    if (child === undefined) throw new Error('Parent resolution did not cold-resume the child.')
    const resolvedPromise = context.parentFeedback.read({ agent: child, feedbackId: state.feedbackId })
    const reattachedQuestion = executeTool(context, {
      agent: child,
      name: 'ask_parent_question',
      args: { questionId: state.questionId },
    })
    const questionAnswer = await executeTool(context, {
      agent: parent,
      name: 'answer_parent_question',
      args: { questionId: state.questionId, answer: 'The pending decision survived Host restart.' },
    })
    const [resolved, reattachedQuestionResult] = await Promise.all([resolvedPromise, reattachedQuestion])
    if (resolved.status !== 'resolved' || resolution?.notified !== true) {
      throw new Error(
        'Cold-resumed feedback status=' +
          resolved.status +
          ', parent status=' +
          String(resolution?.status) +
          ', notified=' +
          String(resolution?.notified) +
          '.',
      )
    }
    const questionAnswerText = requireToolSuccess(questionAnswer, 'Reattached parent answer')
    const reattachedQuestionText = requireToolSuccess(reattachedQuestionResult, 'Reattached child question')
    if (!questionAnswerText.includes('Answer delivered') || !reattachedQuestionText.includes('survived Host restart')) {
      throw new Error('The child could not reattach and receive its durable parent decision.')
    }
    await waitForProviderCalls(callCountPath, childProvider, 2)
    await waitForIdle(child, 'The cold-resumed provider-backed child turn')
    const feedbackResolution = await executeTool(context, {
      agent: parent,
      name: 'resolve_parent_feedback',
      args: {
        responses: [
          { feedbackId: state.currentFeedbackId, disposition: 'accepted', note: 'Accepted in the scratch Host.' },
          { feedbackId: state.staleFeedbackId, disposition: 'accepted', note: 'Do not apply a stale excerpt.' },
          { feedbackId: state.cancelledFeedbackId, disposition: 'accepted' },
        ],
      },
    })
    const feedbackResolutionText = requireToolSuccess(feedbackResolution, 'Parent feedback tool resolution')
    if (
      !feedbackResolutionText.includes(state.currentFeedbackId + ': resolved') ||
      !feedbackResolutionText.includes(state.staleFeedbackId + ': stale') ||
      !feedbackResolutionText.includes(state.cancelledFeedbackId + ': rejected')
    ) {
      throw new Error('The Host feedback tool returned unexpected current, stale, or cancelled statuses: ' + feedbackResolutionText)
    }

    const childProviderCalls = (await readJson(callCountPath))?.[childProvider] ?? 0
    if (childProviderCalls !== 2) throw new Error('The cold-resumed child did not reach the scratch provider a second time.')
    if (resolution?.status !== 'resolved' || resolution.notified !== true) {
      throw new Error('The pending feedback did not resolve and notify its cold-resumed child.')
    }

    await writeJson(
      resultPath,
      {
        passed: true,
        parentQuestionToolPassed: true,
        unauthorizedQuestionAnswerRejected: true,
        questionReattachedAfterRestart: true,
        expiryRecommendedPassed: true,
        expiryDeferredPassed: true,
        feedbackSubmitReadCancelPassed: true,
        feedbackResolvedAfterRestart: true,
        staleAnchorRejected: true,
        oversizedBatchRejected: true,
        childAbsentAtHostRestart: true,
        childResumedAfterResolution: true,
        childProviderCalls,
        feedbackStatuses: {
          current: 'resolved',
          stale: 'stale',
          cancelled: 'rejected',
          coldResume: resolved.status,
        },
        parentNotified: resolution.notified,
      },
      home,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await writeJson(resultPath, { passed: false, error: message }, home)
    throw error
  } finally {
    releaseFirstChildTurn()
    disposeContinuation()
    disposeAdapter()
  }
}

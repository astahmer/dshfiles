import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
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
  await writeFile(path, JSON.stringify(value, null, 2).replaceAll(home, '[scratch-home]'))
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
      const initialCalls = await waitForProviderCalls(callCountPath, childProvider, 1)
      if (initialCalls !== 1) throw new Error('The initial child turn did not reach the scratch provider exactly once.')

      const document = await readFile(resolve(projectPath, 'review.md'), 'utf8')
      const excerpt = document.split(/\r\n|\n|\r/, 1)[0]
      if (excerpt === undefined || excerpt.length === 0) throw new Error('The scratch Markdown anchor is empty.')
      const record = await context.parentFeedback.submit({
        agent: child,
        operationId: 'cold-resume-feedback',
        anchor: {
          kind: 'markdown',
          path: 'review.md',
          revision: createHash('sha256').update(document).digest('hex'),
          startLine: 1,
          endLine: 1,
          excerpt,
        },
        comment: 'Confirm this synthetic feedback target.',
        signal: new AbortController().signal,
      })
      if (record.status !== 'pending') {
        throw new Error('The scratch feedback request ended in status ' + record.status + '.')
      }

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
      const childQuestionWait = context.tools.execute({
        signal: new AbortController().signal,
        callId: questionOperationId,
        name: 'ask_parent_question',
        arguments: questionInput,
        agent: child,
      })
      const parentQuestionAnswer = await context.tools.execute({
        signal: new AbortController().signal,
        callId: randomUUID(),
        name: 'answer_parent_question',
        arguments: { questionId: questionReceipt.questionId, answer: 'Use the alternate choice.' },
        agent: parent,
      })
      const childQuestionResult = await childQuestionWait
      if (parentQuestionAnswer.isError || childQuestionResult.isError || !String(childQuestionResult.value).includes('Use the alternate choice.')) {
        throw new Error('The Agent Questions Host tools did not complete a child question and parent answer.')
      }
      releaseFirstChildTurn()
      await waitForIdle(child, 'The initial provider-backed child turn')
      await waitForIdle(parent, 'The parent feedback notice turn')

      await writeJson(
        statePath,
        {
          phase: 'pending',
          parentSessionId: parent.id,
          childSessionId: child.id,
          feedbackId: record.feedbackId,
          childProviderCalls: initialCalls,
          parentQuestionToolPassed: true,
        },
        home,
      )
      return
    }

    if (state.phase !== 'pending') throw new Error('The scratch feedback state has an unsupported phase.')
    if (state.parentQuestionToolPassed !== true) throw new Error('The scratch question and answer tools were not verified on the first Host boot.')
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
      responses: [{ feedbackId: state.feedbackId, disposition: 'accepted' }],
      signal: new AbortController().signal,
    })
    const child = context.agents.get(state.childSessionId)
    if (child === undefined) throw new Error('Parent resolution did not cold-resume the child.')
    await waitForIdle(child, 'The cold-resumed provider-backed child turn')

    const resolved = await context.parentFeedback.read({ agent: child, feedbackId: state.feedbackId })
    const childProviderCalls = (await readJson(callCountPath))?.[childProvider] ?? 0
    if (childProviderCalls !== 2) throw new Error('The cold-resumed child did not reach the scratch provider a second time.')
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

    await writeJson(
      resultPath,
      {
        passed: true,
        parentQuestionToolPassed: true,
        childAbsentAtHostRestart: true,
        childResumedAfterResolution: true,
        childProviderCalls,
        feedbackStatus: resolved.status,
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

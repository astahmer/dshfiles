import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { defineClientPlugin, type ComposerActionProps } from '@dshfiles/dshx/client'
import { createElement, useEffect, useMemo, type ComponentType } from 'react'
import { z } from 'zod'
import { TestRunCard, TestRunPending, type TestRunActions } from './test-run-card.js'
import { VitestReport } from './vitest-report.js'

const REGISTRANT = '@dshfiles/test-runs'
/** Below the native `bash` view's default 0, so this entry renders and the native one stays reachable as the fallback. */
const PRIORITY = -10
const TEST_COMMAND = /\b(?:vitest|(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?test(?::\w+)?)\b/

const shellArgs = z.object({ command: z.string() })

const commandOf = (argsRaw: string | undefined): string | undefined => {
  if (argsRaw === undefined) return undefined
  try {
    const parsed = shellArgs.safeParse(JSON.parse(argsRaw))
    return parsed.success ? parsed.data.command : undefined
  } catch {
    return undefined
  }
}

const composers = new Map<string, ComposerActionProps['inputActions']>()

/** Renders nothing: it lends the session's composer to the Ask to fix button, which a tool view cannot reach. */
const ComposerBridge = (props: ComposerActionProps) => {
  useEffect(() => {
    composers.set(props.sessionId, props.inputActions)
    return () => {
      if (composers.get(props.sessionId) === props.inputActions) composers.delete(props.sessionId)
    }
  }, [props.sessionId, props.inputActions])
  return null
}

export default defineClientPlugin({
  id: 'test-runs',
  uses: ['ui', 'composer'],
  setup(api) {
    const slots = api.raw.ctx.slots
    const nativeBashView = (): ComponentType<ToolCallViewProps> | undefined => {
      const fallback = slots
        .entries('tool.call.toolview')
        .filter(entry => entry.options.key === 'bash' && entry.registrant !== REGISTRANT)
        .toSorted((left, right) => (left.options.priority ?? 0) - (right.options.priority ?? 0))[0]
      // SAFETY: the ledger erases component types; every entry in the `bash` cell of `tool.call.toolview` takes ToolCallViewProps.
      return fallback?.component as ComponentType<ToolCallViewProps> | undefined
    }

    const BashTestRuns = (props: ToolCallViewProps) => {
      const command = props.phase === 'start' ? commandOf(props.block.argsRaw) : props.phase === 'result' ? commandOf(props.block.call?.argsRaw) : undefined
      const output = props.phase === 'result' && !props.block.isError && props.block.content.length === 1 ? props.block.content[0] : undefined
      const run = useMemo(() => (output?.type === 'text' ? VitestReport.parse(output.text) : undefined), [output])
      const sessionId = props.sessionId
      const actions = useMemo<TestRunActions | undefined>(
        () => ({
          askToFix: text => {
            const composer = composers.get(sessionId)
            return composer === undefined ? false : composer.insertText(text, composer.captureInsertion())
          },
        }),
        [sessionId],
      )
      if (run !== undefined)
        return (
          <TestRunCard
            actions={composers.has(sessionId) ? actions : undefined}
            openFile={(path, options) => props.openFile(run.root === undefined || path.startsWith('/') ? path : `${run.root}/${path}`, options)}
            run={run}
          />
        )
      if (props.phase === 'start' && command !== undefined && TEST_COMMAND.test(command)) return <TestRunPending command={command} />
      const Native = nativeBashView()
      return Native === undefined ? null : createElement(Native, props)
    }

    api.ui.register({ name: 'tool.call.toolview', key: 'bash', priority: PRIORITY, registrant: REGISTRANT, locale: 'conversation' }, BashTestRuns)
    api.composer.registerAction({ id: 'test-runs-composer-bridge', placement: 'left', order: 1000, component: ComposerBridge })
  },
})

import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { Composer, defineClientPlugin, useContract, useSettings } from '@dshfiles/dshx/client'
import { decodeJsonSafe } from '@dshfiles/dshx/json'
import { createElement, useMemo, type ComponentType } from 'react'
import { z } from 'zod'
import { testRunsSettings } from './settings.js'
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
    const parsed = decodeJsonSafe(shellArgs, argsRaw)
    return parsed.success ? parsed.data.command : undefined
  } catch {
    return undefined
  }
}

export default defineClientPlugin({
  id: 'test-runs',
  uses: ['ui'],
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
      const settings = useSettings(testRunsSettings).value
      const composer = useContract(Composer)
      const actions = useMemo<TestRunActions | undefined>(
        () => (composer.status === 'active' ? { askToFix: text => composer.value.insert({ sessionId, text }) } : undefined),
        [composer, sessionId],
      )
      if (run !== undefined && settings?.enabled !== false)
        return (
          <TestRunCard
            actions={settings?.composerActions !== false ? actions : undefined}
            openFailures={settings?.openFailures !== false}
            openFile={(path, options) => props.openFile(run.root === undefined || path.startsWith('/') ? path : `${run.root}/${path}`, options)}
            run={run}
          />
        )
      if (props.phase === 'start' && settings?.enabled !== false && settings?.runningCard !== false && command !== undefined && TEST_COMMAND.test(command))
        return <TestRunPending command={command} />
      const Native = nativeBashView()
      return Native === undefined ? null : createElement(Native, props)
    }

    api.ui.register({ name: 'tool.call.toolview', key: 'bash', priority: PRIORITY, registrant: REGISTRANT, locale: 'conversation' }, BashTestRuns)
  },
})

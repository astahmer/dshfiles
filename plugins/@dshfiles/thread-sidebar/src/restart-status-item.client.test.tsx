// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RestartBridge, type RestartRequest } from './restart-bridge.js'
import type { AutoRestartStatusWire } from './restart-api.js'

/** The status the mocked Host read answers; each test sets it. */
interface AutoStatusHolder {
  current: AutoRestartStatusWire | undefined
}

const autoStatus: AutoStatusHolder = { current: undefined }

vi.mock('@dshfiles/dshx/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@dshfiles/dshx/client')>()),
  useApi: () => ({ safe: { postponeAutoRestart: async () => ({ postponedUntil: 0 }) } }),
  useResource: () => ({ status: 'success', data: autoStatus.current, refetch: () => undefined }),
  useRegistry: () => [],
}))

const { RestartStatusItem } = await import('./restart-status-item.js')

const text = {
  pending: (count: number) => `Restart pending · ${String(count)} plugins`,
  applied: 'Updates applied after a restart',
  manual: 'Restart DSH yourself',
  restart: 'Restart DSH',
  restartWhenIdle: 'Restart when idle',
  autoCountdown: (seconds: number) => `Restarting to apply updates in ${String(seconds)} s`,
  postpone: 'Postpone',
  autoUnsupervised: 'Automatic restart needs DSH started through the supervisor.',
  copyCommand: 'Copy command',
  copied: 'Copied',
  turnOffAuto: 'Turn off automatic restart',
}

const status = (overrides: Partial<AutoRestartStatusWire>): AutoRestartStatusWire => ({
  phase: 'none',
  enabled: true,
  updates: [],
  busy: { turns: 0, jobs: 0, questions: 0 },
  quietSeconds: 60,
  restartAt: null,
  postponedUntil: null,
  command: null,
  run: 'run-1',
  ...overrides,
})

// SAFETY: the item never reads the strip props in these cases.
const item = (): JSX.Element => <RestartStatusItem {...({} as Parameters<typeof RestartStatusItem>[0])} text={text} />

afterEach(() => {
  cleanup()
  act(() => RestartBridge.publish(RestartBridge.empty))
  autoStatus.current = undefined
})

describe('RestartStatusItem', () => {
  it('draws no second restart control while the rail carries Restart, and comes back when it does not', () => {
    act(() => RestartBridge.publish({ hostPlugins: ['@dshfiles/a'], available: true, waitingLabel: null, onRail: true }))
    const view = render(item())
    expect(screen.queryByTestId('status-item-restart')).toBeNull()
    act(() => RestartBridge.publish({ hostPlugins: ['@dshfiles/a'], available: true, waitingLabel: null, onRail: false }))
    view.rerender(item())
    expect(screen.getByTestId('status-item-restart').textContent).toBe('Restart pending · 1 plugins')
  })

  it('offers to turn the automatic restart off from the unsupervised notice', () => {
    autoStatus.current = status({ phase: 'unsupervised', updates: ['@dshfiles/a'], command: '$DSHFILES_DIR/scripts/dsh-launcher' })
    const requests: RestartRequest[] = []
    const stop = RestartBridge.onRequest(request => requests.push(request))
    render(item())
    fireEvent.click(screen.getByTestId('status-item-restart'))
    expect(screen.getByTestId('auto-restart-command').textContent).toBe('$DSHFILES_DIR/scripts/dsh-launcher')
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Turn off automatic restart' }))
    expect(requests).toEqual(['turn-off-auto-restart'])
    stop()
  })
})

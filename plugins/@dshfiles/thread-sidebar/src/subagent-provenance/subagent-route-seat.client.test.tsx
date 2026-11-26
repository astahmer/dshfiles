// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SubagentPreviewDock } from './subagent-preview-dock.js'
import type { SubagentPreviewBindings } from './subagent-live-preview.js'

/**
 * Round 21 D5: a model with no known family (`step-5-preview`) started 22 px left of every marked name in the stacked
 * subagent rows. The dock keeps the kit's empty 16 px seat for it, and so do the list's child rows (`thread-row.client.test.tsx`);
 * inline transcript rows draw no seat (council round 22, item 8; `subagent-tool-row.client.test.tsx`).
 */

afterEach(cleanup)

const PARENT = 'session-parent'
const ROUTES = { 'child-a': 'dshx_fake_commandcode/gpt-6-luna', 'child-b': 'dshx_fake_commandcode/step-5-preview' } as const

const preview: SubagentPreviewBindings = {
  // SAFETY: the dock only prints keys, so the identity translator covers every key it asks for.
  t: (key => key) as SubagentPreviewBindings['t'],
  retainChild: vi.fn(() => ({ ready: new Promise<never>(() => undefined), release: vi.fn() })),
  openChild: vi.fn(),
  openChildAside: vi.fn(),
  canOpenAside: () => false,
}

const list = {
  byId: Object.fromEntries(Object.entries(ROUTES).map(([id, route]) => [id, { projectionValues: { threadSidebarModelRoute: route } }])),
  projectionsBySession: {
    [PARENT]: {
      values: {
        subagentCatalog: [
          { id: 'child-a', mode: 'continuable', label: 'Audit' },
          { id: 'child-b', mode: 'continuable', label: 'Review currency conversion' },
        ],
      },
    },
  },
}

describe('the dock keeps one start edge for model names (round 21 D5)', () => {
  it('seats an unknown family in an empty 16 px mark seat, like a marked one', () => {
    const statuses = new Map(Object.keys(ROUTES).map(id => [id, { running: true }]))
    render(
      <SubagentPreviewDock
        sessionId={PARENT}
        preview={preview}
        runCards={false}
        // SAFETY: the dock reads only these fields of the session list and of each status.
        useSessions={selector => selector(list as never)}
        useSessionStatus={selector => selector(statuses as never)}
      />,
    )
    const models = [...document.querySelectorAll<HTMLElement>('[data-subagent-dock-row] [data-slot="route-model"]')]
    expect(models.map(model => model.textContent)).toEqual(['gpt-6-luna', 'step-5-preview'])
    const unknown = models[1]
    expect(unknown?.getAttribute('data-model-family')).toBe('none')
    expect(unknown?.firstElementChild?.getAttribute('data-model-mark')).toBe('none')
    expect(unknown?.firstElementChild?.className).toContain('dshx:size-4')
  })
})

import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { act, render } from '@testing-library/react'
import { ThreadRow, type RowActions, type ThreadRowProps } from './client.js'
import { DEFAULT_PREFERENCES, type ThreadRowAction } from './organization.js'
import { EMPTY_THREAD_SELECTION } from './thread-selection.js'
import { createThreadMultiSelectionStore } from './thread-multi-selection.js'
import type { ThreadStatus } from './thread-status.js'

/** An observer that reports every row as on screen, so its hover actions and menu button render. */
export class VisibleObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null
  readonly rootMargin: string = '0px'
  readonly scrollMargin: string = '0px'
  readonly thresholds: readonly number[] = [0]
  private readonly callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
  }
  observe(target: Element): void {
    const rect = new DOMRect()
    this.callback([{ isIntersecting: true, boundingClientRect: rect, intersectionRatio: 1, intersectionRect: rect, rootBounds: null, target, time: 0 }], this)
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

const noop = (): void => {}

/** Every row callback as a no-op; the labels are their locale keys, so a test names what it expects exactly. */
export const rowActions = (overrides: Partial<RowActions> = {}): RowActions => ({
  open: noop,
  selection: () => EMPTY_THREAD_SELECTION,
  multiSelection: createThreadMultiSelectionStore(),
  selectForContext: noop,
  clearSelection: noop,
  batch: () => ({
    ids: [],
    anyPinned: false,
    anyUnpinned: false,
    anyLive: false,
    anyArchived: false,
    anyParked: false,
    anyUnparked: false,
    anySettled: false,
    anyUnsettled: false,
    anyMuted: false,
  }),
  batchMutate: noop,
  batchSetParked: noop,
  batchSetSettled: noop,
  batchMute: noop,
  batchUnmute: noop,
  batchMarkUnread: noop,
  batchCopyLinks: noop,
  mutate: async () => {},
  toggleParked: noop,
  toggleSettled: noop,
  copy: async () => {},
  toggleChildren: noop,
  toggleAllChildren: noop,
  moveToSection: noop,
  mute: noop,
  unmute: noop,
  markUnread: noop,
  followUp: noop,
  continueIn: noop,
  turnIntoProject: noop,
  resume: noop,
  dismissRecovery: noop,
  beginRename: noop,
  rename: noop,
  cancelRename: noop,
  setAutoSettleOverride: noop,
  setNotify: noop,
  batchNotifySubscriber: () => undefined,
  batchNotify: noop,
  notifyDefaultLevel: () => 'outcomes',
  actOnStatus: noop,
  peek: noop,
  translate: key => key,
  ...overrides,
})

export const rowSession = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: SessionId('s1'),
  title: 'Refactor pricing rounding',
  displayTitle: 'Refactor pricing rounding',
  cwd: '/work/sample',
  updatedAt: 1_700_000_000_000,
  running: false,
  blank: false,
  retainedBy: {},
  ...overrides,
})

export const rowStatus = (overrides: Partial<ThreadStatus> & Pick<ThreadStatus, 'status'>): ThreadStatus => ({
  group: overrides.status === 'failed' ? 'needs-you' : overrides.status,
  detail: undefined,
  verb: undefined,
  itemId: undefined,
  since: 1_700_000_000_000,
  ...overrides,
})

/** The hover actions a row draws with the shipped preferences, in the shipped order. */
export const defaultRowActions = (): readonly ThreadRowAction[] =>
  DEFAULT_PREFERENCES.rowActionOrder.filter(action => !DEFAULT_PREFERENCES.hiddenRowActions.includes(action))

const NO_LABELS: ThreadRowProps['childAttentionLabels'] = new Map()
const NO_UNREAD: ThreadRowProps['unreadSessionIds'] = new Set()

export const rowProps = (overrides: Partial<ThreadRowProps> = {}): ThreadRowProps => ({
  session: rowSession(),
  unread: false,
  autoSettleOverride: 'inherit',
  unreadSessionIds: NO_UNREAD,
  archived: false,
  pinned: false,
  parked: false,
  settled: false,
  selected: false,
  dragging: false,
  parentTitle: undefined,
  workspaceId: 'sample',
  workspaceTitle: 'sample',
  // No folder: the project mark then draws its empty seat instead of asking the Host for an icon.
  workspacePath: undefined,
  ownWorkspaceName: undefined,
  ownWorkspacePath: undefined,
  ownWorkspaceState: undefined,
  ownWorkspaceStateText: undefined,
  ownWorkspaceStateAt: undefined,
  machine: undefined,
  age: '7m',
  mute: undefined,
  attentionLabel: undefined,
  integrationQueuedAt: undefined,
  needsResume: false,
  resumeBusy: false,
  renaming: false,
  childAttentionLabels: NO_LABELS,
  rowStyle: {
    density: DEFAULT_PREFERENCES.threadRowDensity,
    project: DEFAULT_PREFERENCES.threadRowProject,
    projectColor: DEFAULT_PREFERENCES.threadRowProjectColor,
    projectPalette: DEFAULT_PREFERENCES.projectColorPalette,
    title: DEFAULT_PREFERENCES.threadRowTitle,
    machine: DEFAULT_PREFERENCES.threadRowMachine,
    path: DEFAULT_PREFERENCES.threadRowPath,
    time: DEFAULT_PREFERENCES.threadRowTime,
    statusDot: DEFAULT_PREFERENCES.threadRowStatusDot,
    attentionColors: DEFAULT_PREFERENCES.attentionColors,
    maxChildren: DEFAULT_PREFERENCES.maxChildren,
  },
  rowActions: defaultRowActions(),
  childThreads: [],
  finishedChildThreads: [],
  childrenOpen: false,
  allChildrenShown: false,
  selectedChildId: undefined,
  actions: rowActions(),
  projectMark: true,
  ...overrides,
})

/** Render one row as the list does, on screen (so its hover actions exist). */
export const renderRow = async (overrides: Partial<ThreadRowProps> = {}): Promise<HTMLElement> => {
  let container: HTMLElement | undefined
  await act(async () => {
    container = render(
      <TooltipProvider>
        <ThreadRow {...rowProps(overrides)} />
      </TooltipProvider>,
    ).container
  })
  if (container === undefined) throw new Error('The row did not render.')
  return container
}

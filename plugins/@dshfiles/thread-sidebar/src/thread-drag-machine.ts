import { assign, setup } from '@dshfiles/plugin-ui/machine'
import { SidebarOrganization, type SidebarSection } from './organization.js'

/**
 * Section headers reorder with a pointer gesture, thread rows move between sections with the browser's own drag
 * stream, and the click that ends either gesture belongs to the drag. One machine owns both gestures, so one cannot
 * start while the other is active and a suppressed click belongs to exactly one of them.
 */
export interface ThreadDragRow {
  readonly sessionId: string
  readonly section: SidebarSection
}

export interface ThreadDragSection {
  readonly pointerId: number
  readonly from: number
  readonly startY: number
  /** Measured header centers once the pointer passed the drag threshold; null while it is still a plain press. */
  readonly centers: readonly number[] | null
  readonly to: number
}

export type ThreadDragSuppressed = 'row' | 'section'

export interface ThreadDragCommands {
  readonly moveToSection: (input: { readonly sessionId: string; readonly section: SidebarSection }) => void
  readonly commitSectionOrder: (input: { readonly from: number; readonly to: number }) => void
}

export type ThreadDragEvent =
  | { readonly type: 'row.start'; readonly row: ThreadDragRow }
  | { readonly type: 'row.over'; readonly section: SidebarSection | null }
  | { readonly type: 'row.drop'; readonly section: SidebarSection }
  | { readonly type: 'row.end' }
  | { readonly type: 'section.press'; readonly pointerId: number; readonly from: number; readonly startY: number }
  | { readonly type: 'section.drag'; readonly pointerId: number; readonly centers: readonly number[] }
  | { readonly type: 'section.move'; readonly pointerId: number; readonly position: number }
  | { readonly type: 'section.drop'; readonly pointerId: number; readonly position: number }
  | { readonly type: 'section.end' }
  | { readonly type: 'suppression.consume' }

interface ThreadDragContext {
  readonly commands: ThreadDragCommands
  readonly row: ThreadDragRow | null
  readonly dropSection: SidebarSection | null
  readonly section: ThreadDragSection | null
  readonly suppressed: ThreadDragSuppressed | null
}

const isSectionPointerEvent = (event: ThreadDragEvent): event is Extract<ThreadDragEvent, { readonly pointerId: number }> =>
  event.type === 'section.drag' || event.type === 'section.move' || event.type === 'section.drop'

const sectionDropIndex = (section: ThreadDragSection, position: number): number =>
  SidebarOrganization.dropIndexAt({ centers: section.centers ?? [], fromIndex: section.from, position })

// SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
export const threadDragMachine = setup({
  types: {
    context: {} as ThreadDragContext,
    events: {} as ThreadDragEvent,
    input: {} as ThreadDragCommands,
  },
  guards: {
    sameSectionPointer: ({ context, event }) => context.section !== null && isSectionPointerEvent(event) && event.pointerId === context.section.pointerId,
  },
  actions: {
    startRowDrag: assign(({ event }) => (event.type === 'row.start' ? { row: event.row, dropSection: null } : {})),
    setRowDropSection: assign(({ event }) => (event.type === 'row.over' ? { dropSection: event.section } : {})),
    dropRow: ({ context, event }) => {
      if (event.type !== 'row.drop' || context.row === null || event.section === context.row.section) return
      context.commands.moveToSection({ sessionId: context.row.sessionId, section: event.section })
    },
    startSectionPress: assign(({ event }) =>
      event.type === 'section.press' ? { section: { pointerId: event.pointerId, from: event.from, startY: event.startY, centers: null, to: event.from } } : {},
    ),
    startSectionDrag: assign(({ context, event }) =>
      event.type === 'section.drag' && context.section !== null ? { section: { ...context.section, centers: event.centers } } : {},
    ),
    moveSectionDrag: assign(({ context, event }) => {
      if (event.type !== 'section.move' || context.section === null || context.section.centers === null) return {}
      return { section: { ...context.section, to: sectionDropIndex(context.section, event.position) } }
    }),
    commitSectionDrop: ({ context, event }) => {
      if (event.type !== 'section.drop' || context.section === null || context.section.centers === null) return
      context.commands.commitSectionOrder({ from: context.section.from, to: sectionDropIndex(context.section, event.position) })
    },
    clearRowDrag: assign({ row: null, dropSection: null }),
    clearSectionDrag: assign({ section: null }),
  },
}).createMachine({
  id: 'threadDrag',
  initial: 'idle',
  context: ({ input }) => ({ commands: input, row: null, dropSection: null, section: null, suppressed: null }),
  states: {
    idle: {
      on: {
        'row.start': { target: 'rows', actions: 'startRowDrag' },
        'section.press': { target: 'pressing', actions: 'startSectionPress' },
        'suppression.consume': { actions: assign({ suppressed: null }) },
      },
    },
    rows: {
      on: {
        'row.over': { actions: 'setRowDropSection' },
        'row.drop': {
          target: 'suppressing',
          actions: ['dropRow', assign({ row: null, dropSection: null, suppressed: 'row' as const })],
        },
        'row.end': { target: 'idle', actions: 'clearRowDrag' },
      },
    },
    pressing: {
      on: {
        'section.drag': { target: 'section', actions: 'startSectionDrag' },
        'section.move': { actions: 'moveSectionDrag' },
        'section.drop': { target: 'idle', actions: 'clearSectionDrag' },
        'section.end': { target: 'idle', actions: 'clearSectionDrag' },
      },
    },
    section: {
      on: {
        'section.move': { guard: 'sameSectionPointer', actions: 'moveSectionDrag' },
        'section.drop': {
          guard: 'sameSectionPointer',
          target: 'suppressing',
          actions: ['commitSectionDrop', assign({ section: null, suppressed: 'section' as const })],
        },
        'section.end': { target: 'idle', actions: 'clearSectionDrag' },
      },
    },
    suppressing: {
      // The click that ends a drop arrives after the drag gesture, never later than the next task.
      after: { 0: { target: 'idle', actions: assign({ suppressed: null }) } },
      on: {
        'row.start': { target: 'rows', actions: 'startRowDrag' },
        'section.press': { target: 'pressing', actions: 'startSectionPress' },
        'suppression.consume': { target: 'idle', actions: assign({ suppressed: null }) },
      },
    },
  },
})

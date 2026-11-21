import { defineClientTool, type ClientToolItem } from '@dshfiles/dshx/client'
import * as Schema from 'effect/Schema'
import type { PaletteAction, PaletteActionContext } from './palette-contract.js'

const DEFAULT_LIMIT = 50

const labelOf = (action: PaletteAction): string => (typeof action.label === 'function' ? action.label() : action.label)
const headingOf = (action: PaletteAction): string | undefined => (typeof action.heading === 'function' ? action.heading() : action.heading)

/** An action is listed and runnable only while the palette would offer it. */
const available = (action: PaletteAction, context: PaletteActionContext): boolean => {
  try {
    return action.isAvailable?.(context) ?? true
  } catch {
    return false
  }
}

const matches = (action: PaletteAction, query: string): boolean => {
  const wanted = query.trim().toLocaleLowerCase()
  if (wanted === '') return true
  return [action.id, labelOf(action), headingOf(action) ?? '', ...(action.aliases ?? [])].some(text => text.toLocaleLowerCase().includes(wanted))
}

/**
 * The command palette's actions as client tools: list the ones available where the user is, run one by id. They see
 * the same rows and context the palette shows, so an Agent reaches every command a plugin added to the palette.
 * @param ports - the palette's current rows and the action context of the user's window.
 * @returns the tools to add to `ClientTools`.
 */
const create = (ports: { readonly actions: () => readonly PaletteAction[]; readonly context: () => PaletteActionContext }): readonly ClientToolItem[] => [
  defineClientTool({
    name: 'palette_commands',
    title: 'List palette commands',
    description:
      'The command palette commands available in the user’s window now (they depend on the thread on screen): each with its id, label, group (destination, command, action or thread) and keys. query filters by id, label or alias. Read-only.',
    readOnly: true,
    input: Schema.Struct({
      query: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))).annotate({ description: 'Words to find in the id, label or aliases.' }),
      limit: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200))).annotate({
        description: 'Most commands to return, 1 to 200; defaults to 50.',
      }),
    }),
    execute: input => {
      const context = ports.context()
      const listed = ports.actions().filter(action => available(action, context) && matches(action, input.query ?? ''))
      return {
        total: listed.length,
        thread: context.thread === null ? null : { id: context.thread.id, title: context.thread.title },
        commands: listed.slice(0, input.limit ?? DEFAULT_LIMIT).map(action => ({
          id: action.id,
          label: labelOf(action),
          group: action.group ?? 'command',
          ...(headingOf(action) !== undefined && { heading: headingOf(action) ?? '' }),
          ...(action.keys !== undefined && action.keys.length > 0 && { keys: [...action.keys] }),
        })),
      }
    },
  }),
  defineClientTool({
    name: 'palette_run',
    title: 'Run a palette command',
    description:
      'Run one command palette command by id from palette_commands, exactly as picking it in the palette does; thread actions act on the thread on screen. Some commands archive, stop or change threads: call only when the user asked for that command, and pass confirm: true, which is required.',
    readOnly: false,
    input: Schema.Struct({
      id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300)).annotate({ description: 'Command id from palette_commands.' }),
      confirm: Schema.Literal(true).annotate({ description: 'Must be true: the user asked for this command.' }),
    }),
    execute: async input => {
      const context = ports.context()
      const action = ports.actions().find(candidate => candidate.id === input.id)
      if (action === undefined) throw new Error(`The palette has no command ${input.id}. Call palette_commands for the ids it offers now.`)
      if (!available(action, context))
        throw new Error(`${labelOf(action)} is not available where the user is now (it may need another thread on screen). Call palette_commands again.`)
      await action.run(context)
      return { ran: action.id, label: labelOf(action) }
    },
  }),
]

export class PaletteClientTools {
  static readonly create = create
}

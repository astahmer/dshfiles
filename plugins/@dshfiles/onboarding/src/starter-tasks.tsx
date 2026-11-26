import { BookOpenIcon, BugIcon, FlaskConicalIcon } from '@dshfiles/plugin-ui/icons'
import type { ReactNode } from 'react'

interface StarterTask {
  readonly id: 'explain' | 'rough-edge' | 'test'
  readonly label: string
  readonly prompt: string
}

interface SessionRow {
  readonly blank: boolean
  readonly parentId?: string | undefined
}

const ICONS = { explain: BookOpenIcon, 'rough-edge': BugIcon, test: FlaskConicalIcon } as const

/**
 * Each starter's glyph in its own identity tone (round five C4, council round 3; council round 16 C1: no tile behind
 * it). Identity 5 (green) is never used: it sits beside the success hue.
 */
const TILES = {
  explain: 'dshx:text-identity-7',
  'rough-edge': 'dshx:text-identity-3',
  test: 'dshx:text-identity-2',
} as const satisfies Record<StarterTask['id'], string>

/** Three first tasks for one project, or for "this project" when none is named; each one only reads or proposes first. */
const list = (input: { readonly project: string | undefined }): readonly StarterTask[] => {
  const project = input.project ?? 'this project'
  return [
    { id: 'explain', label: 'Explain the project', prompt: `Explain how ${project} is organised and where I should start reading.` },
    { id: 'rough-edge', label: 'Find a rough edge', prompt: `Find one small bug or rough edge in ${project} and propose a fix before changing anything.` },
    { id: 'test', label: 'Add a missing test', prompt: `Add a test for the most important function in ${project} that has none.` },
  ]
}

/** No top-level thread has a message yet: the first thread is still to come. */
const beforeFirstThread = (sessions: { readonly ids: readonly string[]; readonly byId: Readonly<Record<string, SessionRow | undefined>> }): boolean =>
  sessions.ids.every(id => {
    const session = sessions.byId[id]
    return session === undefined || session.parentId !== undefined || session.blank
  })

export class StarterTasks {
  static readonly list = list
  static readonly beforeFirstThread = beforeFirstThread
}

// Council round 16 C1: the starters are lighter than Resume and Inbox (which keep the filled hero chip): a text-and-icon
// action with no fill, the label in secondary ink, 32px tall with 8px padding and a 6px gap; the hover steps to the
// selected surface and the label to ink; 44pt on touch. The rich-composer hero leaves `[data-hero-card^='starter-']`
// unfilled.
const CHIP =
  'dshx-root dshx:inline-flex dshx:h-8 dshx:min-w-0 dshx:max-w-full dshx:cursor-pointer dshx:items-center dshx:gap-1.5 dshx:rounded-lg dshx:border-0 dshx:bg-transparent dshx:px-2 dshx:text-sm dshx:text-muted-foreground dshx:outline-none dshx:transition-colors dshx:hover:bg-(--dshx-tone-selected) dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:pointer-coarse:h-11 dshx:pointer-coarse:text-base'

const TILE = 'dshx:grid dshx:size-4 dshx:flex-none dshx:place-items-center dshx:[&_svg]:size-3.5'

/**
 * The new-thread hero's suggested tasks (calm-onboarding C2, round five B8): three light actions for the project on
 * screen, beside Resume and Inbox. Until the first thread has a message one sentence explains them; after that the
 * chips stay on their own, so a new thread always offers a start. A chip puts its prompt in the composer and never sends
 * it.
 */
export const StarterTaskCards = (props: {
  readonly project: string | null
  readonly beforeFirstThread: boolean
  readonly insert: (text: string) => void
}): ReactNode => {
  const project = props.project
  if (project === null) return null
  return (
    <>
      {props.beforeFirstThread ? (
        <p className="dshx-root dshx:w-full dshx:text-center dshx:text-sm dshx:text-muted-foreground" data-starter-tasks="">
          Pick a first task for {project}; it goes into the composer and nothing is sent.
        </p>
      ) : null}
      {/* The starters take a line of their own under Resume and Inbox (the hero's navigation line), 14px under it (the
          hero's spacing, council round 14 C4); the row wraps when the column is narrow. */}
      <div className="dshx-root dshx:flex dshx:basis-full dshx:flex-wrap dshx:justify-center dshx:gap-2 dshx:order-1" data-starter-row="">
        {StarterTasks.list({ project })
          .slice(0, 3)
          .map(task => {
            const Icon = ICONS[task.id]
            return (
              <button className={CHIP} data-hero-card={`starter-${task.id}`} key={task.id} onClick={() => props.insert(task.prompt)} type="button">
                <span aria-hidden="true" className={`${TILE} ${TILES[task.id]}`} data-starter-tile="">
                  <Icon />
                </span>
                <span className="dshx:min-w-0 dshx:truncate">{task.label}</span>
              </button>
            )
          })}
      </div>
    </>
  )
}

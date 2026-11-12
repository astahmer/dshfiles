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

// The hero's flat suggestion cards (thread-sidebar's Resume / Review / Inbox): a hairline, 48pt rows on touch.
const CARD =
  'dshx-root dshx:inline-flex dshx:h-9 dshx:min-w-0 dshx:max-w-full dshx:cursor-pointer dshx:items-center dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:bg-transparent dshx:px-3 dshx:text-sm dshx:text-muted-foreground dshx:outline-none dshx:transition-colors dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:pointer-coarse:h-12 dshx:pointer-coarse:text-base dshx:[&_svg]:size-4 dshx:[&_svg]:flex-none'

/**
 * The new-thread hero's first tasks (calm-onboarding C2): one sentence and three cards for the project on screen, only
 * until the first thread has a message. A card puts its prompt in the composer and never sends it.
 */
export const StarterTaskCards = (props: {
  readonly project: string | null
  readonly beforeFirstThread: boolean
  readonly insert: (text: string) => void
}): ReactNode => {
  const project = props.project
  if (project === null || !props.beforeFirstThread) return null
  return (
    <>
      <p className="dshx-root dshx:w-full dshx:text-center dshx:text-sm dshx:text-muted-foreground" data-starter-tasks="">
        Pick a first task for {project}; it goes into the composer and nothing is sent.
      </p>
      {StarterTasks.list({ project }).map(task => {
        const Icon = ICONS[task.id]
        return (
          <button className={CARD} data-hero-card={`starter-${task.id}`} key={task.id} onClick={() => props.insert(task.prompt)} type="button">
            <Icon aria-hidden="true" />
            <span className="dshx:min-w-0 dshx:truncate dshx:font-medium dshx:text-foreground">{task.label}</span>
          </button>
        )
      })}
    </>
  )
}

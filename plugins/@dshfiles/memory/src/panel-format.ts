import { BookOpenIcon, Settings2Icon, ShieldIcon, UsersIcon, type LucideIcon } from '@dshfiles/plugin-ui/icons'

import type { MemoryNoteType, PanelNote, PanelThread } from './api.ts'

export type NoteTone = {
  readonly value: MemoryNoteType
  readonly label: string
  readonly badge: string
  readonly iconTile: string
  readonly accent: string
  readonly Icon: LucideIcon
}

const noteTones = {
  feedback: {
    value: 'feedback',
    label: 'Correction',
    badge: 'dshx:bg-destructive/10 dshx:text-destructive',
    iconTile: 'dshx:bg-destructive/10 dshx:text-destructive',
    accent: 'dshx:text-destructive',
    Icon: ShieldIcon,
  },
  project: {
    value: 'project',
    label: 'Decision',
    badge: 'dshx:bg-violet/10 dshx:text-violet',
    iconTile: 'dshx:bg-violet/10 dshx:text-violet',
    accent: 'dshx:text-violet',
    Icon: Settings2Icon,
  },
  user: {
    value: 'user',
    label: 'Preference',
    badge: 'dshx:bg-info/10 dshx:text-info',
    iconTile: 'dshx:bg-info/10 dshx:text-info',
    accent: 'dshx:text-info',
    Icon: UsersIcon,
  },
  reference: {
    value: 'reference',
    label: 'Reference',
    badge: 'dshx:bg-teal/10 dshx:text-teal',
    iconTile: 'dshx:bg-teal/10 dshx:text-teal',
    accent: 'dshx:text-teal',
    Icon: BookOpenIcon,
  },
} satisfies Record<MemoryNoteType, NoteTone>

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

export class PanelFormat {
  static readonly noteToneOf = (type: MemoryNoteType): NoteTone => noteTones[type]

  static readonly noteToneList = (): readonly NoteTone[] => Object.values(noteTones)

  static readonly projectName = (project: string): string => project.split('/').filter(Boolean).at(-1) ?? project

  static readonly shortThread = (id: string): string => id.replace(/^session-/u, '').slice(0, 8)

  static readonly threadRef = (id: string): string => `t:${PanelFormat.shortThread(id)}`

  static readonly formatDay = (time: number): string => dateFormat.format(time)

  static readonly formatTime = (time: number): string => timeFormat.format(time)

  static readonly formatStamp = (time: number): string => `${PanelFormat.formatDay(time)}, ${PanelFormat.formatTime(time)}`

  static readonly formatCount = (value: number): string => new Intl.NumberFormat().format(value)

  static readonly formatUsd = (value: number | null): string => (value === null ? 'unpriced' : `$${value.toFixed(value > 0 && value < 0.01 ? 4 : 2)}`)

  static readonly formatPercent = (ratio: number | null): string => (ratio === null ? '—' : `${String(Math.round(ratio * 100))}%`)

  static readonly formatBytes = (bytes: number): string => (bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${String(bytes)} B`)

  /** The first sentence is the row title; the rest stays as the note body when there is one. */
  static readonly splitNoteText = (text: string) => {
    const match = /^(.{12,220}?[.!?])(\s+)([\s\S]+)$/u.exec(text.trim())
    if (match === null) return { title: text.trim(), body: '' }
    return { title: match[1] ?? text.trim(), body: match[3] ?? '' }
  }

  static readonly noteExcerpt = (text: string, max = 180): string => (text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`)

  /** A thread row's secondary line: project and the short reference agents use. */
  static readonly threadSubtitle = (thread: PanelThread): string => `${PanelFormat.projectName(thread.project)} · ${PanelFormat.threadRef(thread.id)}`
}

export type NoteStatus = PanelNote['status']

export const noteStatusLabels = {
  valid: 'Active',
  superseded: 'Superseded',
  forgotten: 'Forgotten',
} satisfies Record<NoteStatus, string>

export const noteStatusBadge = {
  valid: 'dshx:bg-success/10 dshx:text-success',
  superseded: 'dshx:bg-warning/10 dshx:text-warning',
  forgotten: 'dshx:bg-destructive/10 dshx:text-destructive',
} satisfies Record<NoteStatus, string>

export const originLabels = {
  'user-requested': 'user asked to remember',
  agent: 'agent note',
  panel: 'edited in this panel',
} satisfies Record<PanelNote['origin'], string>

export const originShortLabels = {
  'user-requested': 'User-requested',
  agent: 'Agent',
  panel: 'Panel',
} satisfies Record<PanelNote['origin'], string>

// The composer remains in ConversationRoot so switching out of the blank-draft
// phase does not remount its textarea.

import type { ReactNode, RefObject } from 'react'
import {
  IconChevronDownOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'
import { projectMarkLetters, projectToneIndex } from '@dshfiles/plugin-ui/components/ui/project-mark'
import type { ConversationContentProps } from '../contract/slots.ts'
import css from './HeroShell.module.css'

/** The owner's locale seat type, passed to hero chrome as a plain prop. */
type HeroTranslate = ConversationContentProps['t']

/**
 * Basename label for the workspace chip (the shared derivation);
 * separator-only paths echo the raw cwd.
 * @param cwd - workspace directory path (non-empty).
 * @returns chip label.
 */
export function workspaceLabel(cwd: string): string {
  const base = workspaceTitleOf(cwd)
  return base !== '' ? base : cwd
}

/**
 * The workspace chip (folder + label + chevron), always interactive: before
 * the first message the workspace stays switchable — picking another one
 * moves the New Session flow to that workspace's blank session. Without a
 * label the chip renders its placeholder state: closed folder + the
 * "Choose project" call to action.
 * @param props.label - chip label (see {@link workspaceLabel}); omitted → placeholder.
 * @param props.menuOpen - menu expansion echo.
 * @param props.onClick - menu toggle.
 * @returns the chip button element.
 */
export function WorkspaceChip({ buttonRef, label, marked = false, menuOpen = false, onClick, t }: {
  buttonRef?: RefObject<HTMLButtonElement>
  label?: string | undefined
  /** The project's mark sits beside the chip (unslop r5 C5), so the chip drops its folder. */
  marked?: boolean
  menuOpen?: boolean
  onClick?: () => void
  t: HeroTranslate
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={css.workspace}
      aria-label={t('hero.chooseWorkspace')}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onClick={onClick}
    >
      {label === undefined
        ? <IconFolderCloseRegular className={css.folder} size={16} />
        : marked ? null : <IconFolderOpenRegular className={css.folder} size={16} />}
      <span className={css.workspaceLabel}>{label ?? t('hero.chooseWorkspace')}</span>
      <IconChevronDownOutlineRegular className={css.chevron} size={12} />
    </button>
  )
}

/** Hero chrome props. The run row rides inside the InputBar card, not here. */
export interface HeroShellProps {
  /** The owner's locale seat, passed down as a plain prop. */
  t: HeroTranslate
  /** The project the new thread will work in, once one is chosen: the headline names it. */
  project?: string | undefined
  /** Overlay content after the stack (modals). */
  children?: ReactNode
}

/** The sentence's text never changes; only a mark marks it up (U+0000 cannot occur in a translation or a project name). */
const PROJECT_SLOT = '\u0000'

/**
 * "What should we build in [BA] billing-api?" (unslop r5 C5, council round 4): the project in the headline carries its
 * identity tile, the one the thread list, tabs and run row draw: the kit's tone class and letters, drawn by CSS from
 * `data-letters` (the kit's ProjectMark puts its letters in the text), so the heading's text stays the sentence for
 * reading, copying and finding it.
 */
function HeadlineProject({ t, project }: { t: HeroTranslate; project: string }) {
  const [before = '', after = ''] = t('hero.headlineProject', { project: PROJECT_SLOT }).split(PROJECT_SLOT)
  return (
    <>
      {before}
      <span className={css.project} data-hero-project="">
        <span
          aria-hidden
          data-slot="project-mark"
          data-letters={projectMarkLetters(project)}
          className={`${css.projectMark} project-tone-balanced-${String(projectToneIndex(project))}`}
        />
        {project}
      </span>
      {after}
    </>
  )
}

/**
 * Render the hero chrome (visual refresh T3.4): one calm headline that names the project, no brand clipart and no
 * Preview badge. The composer and the suggestion cards stay mounted outside this component.
 * @param props - see {@link HeroShellProps}.
 * @returns the centered hero element tree.
 */
export function HeroShell({ t, project, children }: HeroShellProps) {
  return (
    <div className={css.root} data-hero-shell="">
      <div className={css.stack}>
        <h2 className={css.headline} data-hero-headline="">
          {project === undefined ? t('hero.headline') : <HeadlineProject t={t} project={project} />}
        </h2>
      </div>
      {children}
    </div>
  )
}

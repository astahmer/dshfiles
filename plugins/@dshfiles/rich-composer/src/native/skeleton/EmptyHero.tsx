// The composer remains in ConversationRoot so switching out of the blank-draft
// phase does not remount its textarea.

import type { ReactNode, RefObject } from 'react'
import {
  IconChevronDownOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'
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
export function WorkspaceChip({ buttonRef, label, menuOpen = false, onClick, t }: {
  buttonRef?: RefObject<HTMLButtonElement>
  label?: string | undefined
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
        : <IconFolderOpenRegular className={css.folder} size={16} />}
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
        <div className={css.headline}>
          {/* figma 34:10412: fish 34×25 leading the headline, gap 10. */}
          <span
            className={css.fishHitbox}
            onPointerEnter={(event) => {
              if (event.pointerType !== 'touch'
                && window.matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches) {
                setHovering(true)
              }
            }}
            onPointerLeave={() => { setHovering(false) }}
          >
            {renderSlot('conversation.hero.brand.mark', { size: 34, className: css.fish }, {
              fallback: <HeroFish hovering={hovering} />,
            })}
          </span>
          <span className={css.titleGroup}>
            {/* Own element: keeps the headline text addressable apart from the badge. */}
            <span>{t('hero.headline')}</span>
            <span className={css.previewBadge}>{t('hero.preview')}</span>
          </span>
        </div>
        <div className={css.body}>
          {/* The composer remains mounted outside this component. */}
        </div>
      </div>
      {children}
    </div>
  )
}

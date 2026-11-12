/** The default composer body: the 'conversation.composer.bar' slot entry.
 * Machine state arrives through the standard provide channel
 * (useInput + inputActions); the keyboard/DOM command face and stop arrive
 * through this entry's own inject, whose hooks compartment binds
 * useNotices/useLexicon; layout-phase inputs (variant and placeholder) ride
 * the owner props. Session facts
 * (running/removed/promptError) are self-selected via useSession.
 *
 * The text surface is the shell-owned Lexical editor bound here through
 * ComposerContentEditable; chips render as decorator portals, and the
 * keymap registers submit/menu/paste gestures on the editor command layer.
 * The no-session state renders the SAME div inert as the Workspace-picker
 * trigger instead of a parallel tree.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ChangeEvent, CSSProperties, KeyboardEvent, MouseEvent } from 'react'
import clsx from 'clsx'
import {
  focusWithoutRing, IconPlusOutlineMedium, IconTriangleRightFillRegular, IconWarningOutlineRegular, isMobileDevice, Toast, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: the `plan` projection key merge (the TodoDock posture — the
// composer reads a host-computed value; the domain owns the key).
import type {} from '@deepseek-ai/dsh-plan-mode/client'
// Type-only: the `goal` projection key merge (hint disambiguation).
import type {} from '@deepseek-ai/dsh-goal/client'
// The `imageLimits` projection key merge (intake pre-check) arrives with the
// wire types: apiproxy's sessions contract declares it, and client-runtime's
// api-remotes import already places it in every client program.
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComposerBarProps } from '../contract/slots.ts'
import { DraftEditor } from '../input/editor/DraftEditor.tsx'
import {
  focusDraftEditor, installDraftFilePicker, installDraftKeyboardDismissal, installDraftKeymap, installDraftWheel,
  keepDraftFocus, revealDraftSelection,
} from '../input/editor/view-binding.ts'
import { resolveSubmitMode } from '../input/submission-policy.ts'
import { attachmentErrorText, imageSizeText } from '../image-labels.ts'
import { parsePastedComposerText } from '../../paste-references.ts'
import { LargePasteModel } from '../../large-paste.ts'
import { isImageMediaType, withCanonicalImageType } from '../canonical-image-type.ts'
import { ContextMeter } from './ContextMeter.tsx'
import { AnnotationsPill } from './AnnotationsPill.tsx'
import { observeControlRow } from './control-row-layout.ts'
import css from './InputBar.module.css'

const noSubscription = (): (() => void) => () => {}

/** `@dshfiles/workbench`'s `KeptThreadViews.shownEvent`: a kept thread view was shown again without remounting. */
const THREAD_VIEW_SHOWN_EVENT = 'dshfiles:thread-view-shown'

export type InputBarProps = ComposerBarProps

/**
 * Window event the composer sends to ask for a fresh new-thread draft (Primary+Alt+Enter anywhere, Primary+Enter on the
 * new-thread page); @dshfiles/command-palette, which owns New thread, answers it. Nothing listens without it.
 */
export const START_NEW_THREAD_EVENT = 'dshfiles:start-new-thread'
/** A send slower than this to leave the draft no longer opens a fresh draft. */
const FRESH_DRAFT_WAIT_MS = 15_000
/** The platform's primary modifier as the send tooltip spells it (composer redesign b:v9yh). */
const MOD = typeof navigator !== 'undefined' && /mac|iphone|ipad/iu.test(navigator.userAgent) ? '⌘' : 'Ctrl+'

/**
 * The send button's glyph for what a click does now (visual refresh T3.3). Keyed by mode at the call site, so a
 * change remounts it and the CSS entry animation plays once.
 * @param props.mode - stop, steer into the running turn, queue behind it, or send.
 * @returns a 16px decorative svg.
 */
function SendGlyph({ mode }: { readonly mode: 'stop' | 'steer' | 'queue' | 'send' }) {
  if (mode === 'stop') {
    return (
      <svg className={css.sendGlyph} viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        <rect x="3.5" y="3.5" width="9" height="9" rx="2" fill="currentColor" />
      </svg>
    )
  }
  if (mode === 'steer') {
    // A turn into the running line: the message joins the current turn.
    return (
      <svg className={css.sendGlyph} viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3.5 2.5v5a3 3 0 0 0 3 3h6" />
        <path d="M9.5 7.5l3 3-3 3" />
      </svg>
    )
  }
  if (mode === 'queue') {
    // A line added under the queue: the message waits for the running turn.
    return (
      <svg className={css.sendGlyph} viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
        <path d="M2.5 4h8M2.5 8h8M2.5 12h4.5" />
        <path d="M12 10v5M9.5 12.5h5" />
      </svg>
    )
  }
  return (
    <svg className={css.sendGlyph} viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 13V3" />
      <path d="M3.5 7.5L8 3l4.5 4.5" />
    </svg>
  )
}

export const InputBar = memo(function InputBar({
  useSession, useInput, inputActions, keyboard, addFiles, removeAttachment, resolveDraftAttachments,
  retryFileUpload, registerFileIntake, promptHistory,
  toggleCommandMenu, stop, retry, t,
  renderSlot, useBusyEnter, useFileUploads, useNotices, useLexicon, useMenuLauncher, useStopShortcut,
  useAccess,
  useProjection, sessionId, variant, occurrence, disabled: inert = false, blocked, insertReference,
  workspacePickerOpen = false, onRequestWorkspace,
  placeholder, accessory, runRow, runSummary,
}: InputBarProps) {
  const input = useInput(s => s)
  const notice = useNotices(s => s)
  const busyEnter = useBusyEnter(s => s)
  const stopKeys = useStopShortcut(keys => keys)
  // A page whose access snapshot excludes prompting, stopping, or uploading to this Session is offered
  // no Send, no Stop, or no file intake rather than a disabled control. `useAccess` is undefined only
  // without a Session, where the bar is an inert placeholder with no keyboard, stop, or file intake.
  const promptDenied = useAccess('session/prompt') === false
  const cancelDenied = useAccess('session/cancel') === false
  const uploadDenied = useAccess('fileUploads/upload') === false
  const stopAction = cancelDenied ? undefined : stop
  void useLexicon // hook seat stays bound by the inject compartment; text-ref decoration rides the shell's editor transforms
  const commandMenuOpen = useMenuLauncher(source => source === 'command')
  const [activity, setActivity] = useState(false)
  useEffect(() => { setActivity(false) }, [sessionId])
  const promptError = useSession(s => s.promptError) ?? null
  const running = useSession(s => s.running) ?? false
  const retryableFailure = useProjection('conversationContinuation') ?? undefined
  const pendingHumanInput = useProjection('inbox', inbox =>
    inbox?.['next-step'].some(message =>
      typeof message === 'object' && message !== null && 'source' in message
      && typeof message.source === 'object' && message.source !== null && 'kind' in message.source
      && message.source.kind === 'user') ?? false)
  const historyOpen = useSession(s => s.openState === 'open') ?? false
  const submissionPending = useSession(s => s.pendingSubmissions.length > 0) ?? false
  const subagent = useSession(s => s.subagent) ?? null
  const removed = useSession(s => s.removed) ?? false
  // Plan mode swaps the composer placeholder (the projection is the folded
  // host value; owner-prop placeholders — hero, session-unavailable — win).
  const planActive = useProjection('plan', plan => plan !== undefined && (plan.pending ? !plan.active : plan.active))
  // The narrow meter line's ⋯: its readings on a second line (b:gyk7).
  const [metaExpanded, setMetaExpanded] = useState(false)
  // Absent (undefined: no frame yet) and cleared (null) both mean no goal.
  const hasGoal = useProjection('goal', goal => goal != null)
  // Session-maybe: the machine faces are absent together while no session is
  // current; the bar renders the same DOM inert instead of a parallel tree.
  const live = input !== undefined && keyboard !== undefined && inputActions !== undefined
  const draft = input?.draft ?? ''
  const editor = keyboard?.editor ?? null
  const attachments = useMemo(
    () => input === undefined || resolveDraftAttachments === undefined ? [] : resolveDraftAttachments(input.attachmentIds),
    [resolveDraftAttachments, input?.attachmentIds],
  )
  const annotationCount = useSyncExternalStore(
    keyboard?.annotations.subscribe ?? noSubscription,
    () => keyboard?.annotations.snapshot().length ?? 0,
  )
  const empty = draft.trim() === '' && attachments.length === 0 && annotationCount === 0
  const uploads = useFileUploads(snapshot => snapshot)
  // Send waits for every picked file and every uploading image: uploading and
  // failed drafts both hold the gate (a failed upload is retried or removed,
  // never silently dropped). An image draft without an upload sends inline.
  const uploadsPending = attachments.some(attachment => attachment.kind === 'file'
    ? uploads[attachment.id]?.status !== 'ready'
    : uploads[attachment.id] !== undefined && uploads[attachment.id]?.status !== 'ready')
  // Transient error banner (machine notices, image-intake rejections, and
  // prompt failures): the seq keys the Toast so an identical repeated message
  // restarts the hold-then-fade cycle instead of reusing the faded one.
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const showToast = useCallback((text: string) => {
    toastSeq.current += 1
    setToast({ seq: toastSeq.current, text })
  }, [])
  const dismissToast = useCallback(() => { setToast(null) }, [])
  // The deployment's image-intake limits (absent while no attachment service
  // is composed — the pre-check below then defers entirely to the host).
  const imageLimits = useProjection('imageLimits')
  // Enter while uploads hold the send explains the first failed draft; a Host refusal names its reason.
  const failedUpload = attachments.map(attachment => uploads[attachment.id]).find(upload => upload?.status === 'error')
  const uploadsHeldText = failedUpload?.status !== 'error'
    ? t('file.stillUploading')
    : failedUpload.reason === undefined ? t('file.uploadFailed') : attachmentErrorText(t, failedUpload.reason, imageLimits)
  // Prompt failures are ordinary failures (no create/attach transaction exists
  // anymore): the toast announces promptError, the draft stays in the machine,
  // and the user resubmits. A remount over a session whose machine still holds
  // an unresolved promptError deliberately re-announces it once — the failure
  // is still pending, and a transient banner is its only surface. Attachment
  // rejections show product copy keyed by the wire reason — whichever domain
  // refused them. Writer contention has localized recovery guidance; other
  // failures retain the diagnostic message and code.
  useEffect(() => {
    if (promptError === null) return
    const { error } = promptError
    if (error.code === 'session/writer-held') {
      showToast(t('error.sessionInUse'))
      return
    }
    showToast(error.code === 'session/attachment-invalid' || error.code === 'subagent/attachment-invalid'
      ? attachmentErrorText(t, error.details.reason, imageLimits)
      : `${error.message} (${error.code})`)
  }, [promptError, showToast, t, imageLimits])
  useEffect(() => {
    if (notice?.level === 'error') showToast(notice.text)
  }, [notice, showToast])
  const rowRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const row = rowRef.current
    if (row === null) return
    return observeControlRow(row, { iconStep: () => !row.classList.contains(css.rowHero ?? '') })
  }, [])
  const cardRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const continuable = subagent?.address.mode === 'continuable'
  const disabled = removed || inert || !live || blocked !== undefined
  const locked = disabled
  // The model seat is the ONE control a block leaves live: every block this
  // contract has is cleared by choosing a model, so locking it too would leave
  // the composer asking for the only thing it prevents. The other reasons to
  // be disabled do lock it — there is no session to choose a model for.
  const modelSeatLocked = removed || inert || !live
  const machineBusy = input?.phase === 'adjudicating' || input?.phase === 'submitting' || input?.phase === 'sending'
  // The message waits for the Host to accept it; Send shows progress instead of the arrow.
  const sending = input?.phase === 'sending'
  // The no-workspace surface remains the resident DOM node but acts as the
  // existing picker trigger. Message controls stay locked until a Session
  // exists; the trigger itself is read-only rather than disabled so pointer
  // and keyboard users can reach the recovery action.
  const workspaceTrigger = inert && !removed && onRequestWorkspace !== undefined
  const editorDisabled = removed || (locked && !workspaceTrigger)
  const editable = live && !locked && !machineBusy
  const steeringAvailable = subagent === null || subagent.address.mode === 'continuable'
  const canSteerQueue = !locked && !machineBusy && !commandMenuOpen && empty && running && steeringAvailable
    && input.queue.length > 0

  useEffect(() => {
    if (input === undefined || inputActions === undefined) return
    if (attachments.length !== input.attachmentIds.length) {
      inputActions.pruneAttachments(attachments.map(attachment => attachment.id))
    }
  }, [attachments, input?.attachmentIds, inputActions])

  // Scroll the draft scrollport the minimum that brings the selection focus
  // into view — the browser's own behavior for typing, performed for the
  // paths where it does not act (programmatic focus with preventScroll, and
  // session switches that land the caret off screen). The live DOM selection
  // is the ruler; no mirror layer exists to consult.
  const revealSelection = (): void => {
    revealDraftSelection(scrollRef)
  }

  // Automatic desktop focus restores and reveals the draft selection without
  // scrolling the conversation.
  useEffect(() => {
    if (locked || editor === null) return
    if (isMobileDevice()) return
    focusDraftEditor(editor, revealSelection)
  }, [locked, sessionId, editor])

  // A thread view the workbench kept mounted is shown again without remounting, so the unlock effect above does not
  // run; take focus the same way. The draft's scroll offset survived with the view, so nothing needs revealing.
  useEffect(() => {
    if (locked || editor === null) return
    const onShown = (event: Event): void => {
      const root = editor.getRootElement()
      if (root !== null && event.target instanceof Node && event.target.contains(root)) focusDraftEditor(editor, () => undefined)
    }
    document.addEventListener(THREAD_VIEW_SHOWN_EVENT, onShown)
    return () => document.removeEventListener(THREAD_VIEW_SHOWN_EVENT, onShown)
  }, [locked, editor])

  // A read-only phase can move focus to the body. Restore the composer's
  // keyboard position without reopening the mobile keyboard or taking focus
  // from a control the user selected meanwhile.
  const busyPhaseSeen = useRef(false)
  useEffect(() => {
    if (machineBusy) {
      busyPhaseSeen.current = true
      return
    }
    if (!busyPhaseSeen.current) return
    busyPhaseSeen.current = false
    if (locked || editor === null) return
    if (document.activeElement !== null && document.activeElement !== document.body) return
    if (isMobileDevice()) {
      if (cardRef.current !== null) focusWithoutRing(cardRef.current, { preventScroll: true })
    } else {
      focusDraftEditor(editor, revealSelection)
    }
  }, [machineBusy])

  // A persisted draft arrives AFTER the unlock effect: DefaultConversationViews
  // adopts it in its own mount effect, and a parent's mount effect runs after
  // its children's. Reveal when the draft becomes non-empty so a restored long
  // draft does not stay at its head with the caret at its end. This effect does
  // not focus: send-clear, failed-send restore, and first-character transitions
  // must not steal focus from another control the user moved to.
  useEffect(() => {
    if (locked || draft === '') return
    revealSelection()
  }, [draft !== ''])

  // Wheel chaining on the draft scrollport, one lifetime (it is never
  // unmounted — the inert state renders the same element disabled). While the
  // capped box can still move in this direction, keep the native scroll; only
  // at its own edge forward the delta to the active conversation scrollport, so
  // a short draft never traps the gesture and a long draft stays scrollable.
  // Hero mounts have no host and keep native wheel scrolling.
  useEffect(() => {
    return installDraftWheel(scrollRef)
  }, [])

  // Intake pre-check: an addition that would break a projected image limit is
  // refused as a whole batch, announced immediately, and never enters the
  // rail. Only the image subset is limit-checked: generic files carry no
  // client-side size or count limit and upload as soon as they are picked.
  // The host enforces the same image limits at submit for callers that bypass
  // this composer.
  const intakeFiles = useCallback((intake: readonly File[], directories?: ReadonlySet<File>): boolean => {
    if (uploadDenied || locked || machineBusy || (subagent !== null && !continuable)
      || addFiles === undefined || intake.length === 0) return false
    const files = intake.map(file => directories?.has(file) === true ? file : withCanonicalImageType(file))
    const rejected = ((): string | null => {
      // Child prompts support images, but not generic file receipts or the
      // Desktop path-reference fallback. Refuse mixed batches before intake.
      if (continuable && files.some(file => directories?.has(file) || !isImageMediaType(file.type))) {
        return t('image.unsupportedType')
      }
      if (imageLimits !== undefined) {
        const mediaTypes = imageLimits.mediaTypes as readonly string[]
        const images = files.filter(file => mediaTypes.includes(file.type))
        const imageAttachments = attachments.filter(attachment => attachment.kind === 'image')
        if (imageAttachments.length + images.length > imageLimits.maxImagesPerMessage) {
          return t('image.tooMany', { count: imageLimits.maxImagesPerMessage })
        }
        if (images.some(file => file.size > imageLimits.maxImageBytes)) {
          return t('image.fileTooLarge', { size: imageSizeText(imageLimits.maxImageBytes) })
        }
        const total = imageAttachments.reduce((sum, attachment) => sum + attachment.file.size, 0)
          + images.reduce((sum, file) => sum + file.size, 0)
        if (total > imageLimits.maxMessageImageBytes) {
          return t('image.totalTooLarge', { size: imageSizeText(imageLimits.maxMessageImageBytes) })
        }
      }
      return addFiles(files, directories)
    })()
    if (rejected !== null) showToast(rejected)
    return rejected === null
  }, [uploadDenied, locked, machineBusy, subagent, continuable, addFiles, attachments, imageLimits, showToast, t])

  const canAcceptDrop = !uploadDenied && (subagent === null || continuable) && !locked && !machineBusy && addFiles !== undefined
  const insertText = useCallback((text: string): void => {
    if (keyboard === undefined) return
    if (inputActions === undefined || insertReference === undefined) {
      keyboard.paste(text)
      return
    }
    for (const part of parsePastedComposerText(text)) {
      if (part.kind === 'text') {
        if (part.text !== '') keyboard.paste(part.text)
        continue
      }
      if (!insertReference(part.reference, inputActions.captureInsertion())) keyboard.paste(part.wireText)
    }
  }, [inputActions, insertReference, keyboard])

  // A paste of 32 KiB or more becomes a text file attachment; the notice offers it back as text.
  const [largePaste, setLargePaste] = useState<{ readonly file: File; readonly text: string } | null>(null)
  useEffect(() => { setLargePaste(null) }, [sessionId])
  const largePasteId = largePaste === null
    ? undefined
    : attachments.find(attachment => attachment.kind === 'file' && attachment.file === largePaste.file)?.id
  useEffect(() => {
    if (largePaste !== null && largePasteId === undefined) setLargePaste(null)
  }, [largePaste, largePasteId])
  const pasteText = useCallback((text: string): void => {
    if (!continuable && LargePasteModel.isLarge(text)) {
      const file = LargePasteModel.fileFor({ text, at: new Date() })
      if (intakeFiles([file])) {
        setLargePaste({ file, text })
        return
      }
    }
    insertText(text)
  }, [continuable, intakeFiles, insertText])
  const pasteLargeAsText = (): void => {
    if (largePaste === null) return
    if (largePasteId !== undefined) removeAttachment?.(largePasteId)
    setLargePaste(null)
    if (editor !== null) focusDraftEditor(editor, revealSelection)
    insertText(largePaste.text)
  }
  // A plain prompt replaces the draft in one write. A prompt holding thread references is rebuilt as chips, but only
  // after the clearing write commits: inserting inside the same key handler lands in the document that write replaces.
  const replaceDraft = useCallback((text: string): void => {
    if (inputActions === undefined) return
    if (parsePastedComposerText(text).every(part => part.kind === 'text')) {
      inputActions.setDraft(text)
      return
    }
    inputActions.setDraft('')
    queueMicrotask(() => { insertText(text) })
  }, [inputActions, insertText])

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const onPickFiles = (e: ChangeEvent<HTMLInputElement>): void => {
    const picked = e.target.files === null ? [] : [...e.target.files]
    // Reset so picking the same file again re-fires the change event.
    e.target.value = ''
    if (picked.length > 0) intakeFiles(picked)
  }

  // Send in the background / send and start another (dshfiles plan Q2 T2.5): once the send went out (the draft
  // emptied and the machine settled), ask for a fresh new-thread draft. A send that never goes out drops the request.
  const freshDraftRequested = useRef<number | null>(null)
  const requestFreshDraft = useCallback((): void => {
    freshDraftRequested.current = Date.now()
  }, [])
  useEffect(() => {
    const requestedAt = freshDraftRequested.current
    if (requestedAt === null) return
    if (Date.now() - requestedAt > FRESH_DRAFT_WAIT_MS) {
      freshDraftRequested.current = null
      return
    }
    if (machineBusy || draft !== '') return
    freshDraftRequested.current = null
    window.dispatchEvent(new CustomEvent(START_NEW_THREAD_EVENT))
  }, [draft, machineBusy])
  const draftPage = variant === 'hero'

  // The keymap handlers read live bar state through this ref so the editor
  // registration survives re-renders without re-arming per keystroke.
  const gate = useRef({
    locked, machineBusy, canSteerQueue, running, steeringAvailable, busyEnter,
    intakeFiles, pasteText, uploadsPending, uploadsHeldText, showToast, canAcceptDrop, promptHistory, replaceDraft, draftPage, requestFreshDraft,
  })
  gate.current = {
    locked, machineBusy, canSteerQueue, running, steeringAvailable, busyEnter,
    intakeFiles, pasteText, uploadsPending, uploadsHeldText, showToast, canAcceptDrop, promptHistory, replaceDraft, draftPage, requestFreshDraft,
  }

  useEffect(() => {
    if (keyboard === undefined) return
    return installDraftFilePicker(keyboard, gate, fileInputRef)
  }, [keyboard])

  useEffect(() => {
    if (editor === null || keyboard === undefined) return
    return installDraftKeymap(editor, keyboard, gate)
  }, [editor, keyboard])

  useEffect(() => {
    if (editor === null) return
    return installDraftKeyboardDismissal(editor, cardRef)
  }, [editor])

  // A document paste outside an editable control addresses at most one
  // mounted composer; the shared route elects it from focus and the main
  // occurrence.
  useEffect(() => registerFileIntake({
    // The card is an unconditional descendant attached before this effect.
    card: cardRef.current as HTMLDivElement,
    occurrence,
    accepts: () => gate.current.canAcceptDrop,
    add: (files, directories) => { gate.current.intakeFiles(files, directories) },
  }), [registerFileIntake, occurrence])

  // Button presses steal focus from the editor; suppress at mousedown so
  // typing continues seamlessly. Lexical's focus() carries preventScroll and
  // restores the previous selection, so no reveal is needed: the caret has
  // not moved, and the next keystroke gets the browser's native one.
  const keepFocus = (e: MouseEvent<HTMLButtonElement>): void => {
    keepDraftFocus(e, editor)
  }

  const onCardMouseDown = (e: MouseEvent<HTMLDivElement>): void => {
    if (!editable || editor === null || e.button !== 0 || e.defaultPrevented) return
    const target = e.target
    if (!(target instanceof Element) || !e.currentTarget.contains(target)) return
    if (target.closest('[data-composer-overlay]') !== null) return
    if (scrollRef.current?.contains(target)) return
    const control = target.closest('button, a, input, select, textarea, [role="button"], [contenteditable], [tabindex]')
    if (control !== null && control !== e.currentTarget && e.currentTarget.contains(control)) return
    e.preventDefault()
    // Lexical's stored selection can lag behind native caret moves, so calling
    // editor.focus() on a focused editor can restore an older caret.
    if (document.activeElement !== editor.getRootElement()) focusDraftEditor(editor, revealSelection)
  }

  const onToggleCommandMenu = (): void => {
    if (keyboard === undefined) return
    // The menu is a combobox over the editor, so the keyboard has to be there
    // before the launcher opens it: activating the button from the keyboard
    // leaves focus on the button, and restoring it afterwards would re-track an
    // empty draft and close the menu again. A touch device has no keyboard to
    // drive it with: its on-screen keyboard would cover half the menu, so the
    // editor gives up focus instead and the keyboard drops.
    const caret = keyboard.caretSpan()
    if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) {
      editor?.getRootElement()?.blur()
    } else if (editor !== null) focusDraftEditor(editor, revealSelection)
    toggleCommandMenu?.(caret)
  }

  // The no-session Workspace trigger: the resident editable div acts as the
  // picker trigger for keyboard users (no editor is bound in this state).
  const onWorkspaceKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!workspaceTrigger) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onRequestWorkspace()
    }
  }

  // An ordinary running session keeps Stop while the composer is empty or
  // owner-blocked; an actionable draft gets the busy Send action, delivered
  // through the same mode plain Enter resolves to. The label names that mode
  // only when the click would deliver a plain message right now — an enabled
  // button (no pending upload) over a non-empty draft that is neither a
  // claimed command nor a `/` line headed for adjudication — so it never
  // describes a delivery the click cannot or does not perform; every other
  // state keeps plain Send. A continuable child keeps Send primary and
  // exposes Stop independently, and so does a running session while a
  // message waits for the Host.
  const primaryStops = running && subagent === null && !sending && (empty || blocked !== undefined)
  const primaryRetries = !running && subagent === null && empty && retryableFailure !== undefined
    && !pendingHumanInput && historyOpen && !submissionPending && !disabled && input.queue.length === 0
    && input.phase === 'plain' && retry !== undefined
  // Disabled native buttons may omit mouseleave; their tooltip must close from state.
  const primaryDisabled = primaryStops ? stopAction === undefined
    : (!primaryRetries && empty) || disabled || machineBusy
  const interruptible = running && (continuable || (sending && subagent === null))
  const primarySubmitMode = resolveSubmitMode(busyEnter, running, 'enter', steeringAvailable)
  const plainMessageDraft = !empty && input?.phase === 'plain' && !draft.trimStart().startsWith('/')
  // Visual refresh T3.3: one round button whose glyph says what a click does now — send, queue behind the running
  // turn, steer into it, or stop; upstream adds the Host-acceptance wait and continuing a retryable failure.
  const sendMode: 'stop' | 'sending' | 'continue' | 'steer' | 'queue' | 'send' = primaryStops
    ? 'stop'
    : sending
      ? 'sending'
      : primaryRetries
        ? 'continue'
        : running && steeringAvailable && !disabled && !uploadsPending && plainMessageDraft
          ? primarySubmitMode === 'steer' ? 'steer' : 'queue'
          : 'send'
  const primaryLabel = {
    stop: t('input.stop'),
    sending: t('input.sending'),
    continue: t('input.continue'),
    steer: t('input.send.steer'),
    queue: t('input.send.queue'),
    send: t('input.send'),
  }[sendMode]
  // The tooltip lists the three send keys (composer redesign b:v9yh): Enter, Primary+Enter (a fresh draft on the
  // new-thread page, the other delivery while a turn runs) and Primary+Alt+Enter (send and start a new thread).
  const acceleratedLabel = variant === 'hero'
    ? t('input.send.keepDraft')
    : running && steeringAvailable
      ? primarySubmitMode === 'steer' ? t('input.send.queue') : t('input.send.steer')
      : t('input.send.whileRunning')
  const sendTooltip = sendMode === 'stop' || sendMode === 'sending' || sendMode === 'continue'
    ? primaryLabel
    : `${primaryLabel} ↵ · ${acceleratedLabel} ${MOD}↵ · ${t('input.send.newThread')} ${MOD}⌥↵`
  const onPrimary = (): void => {
    if (primaryStops) {
      stopAction?.()
      return
    }
    if (primaryRetries) {
      retry(retryableFailure)
      return
    }
    if (keyboard === undefined) return // absent machine: the button is disabled
    // A held send says why instead of sitting disabled: a tap on a phone has no tooltip to read.
    if (uploadsPending) {
      showToast(uploadsHeldText)
      return
    }
    /* v8 ignore next -- defensive: the primary button is disabled for empty and disabled states. */
    if (!empty && !disabled && !machineBusy) keyboard.submit(primarySubmitMode, 'click')
  }

  // Claim ghost hint: rendered by CSS as generated content after the last
  // paragraph while the claim's args are blank (a hint implies a single-line
  // token draft). The translated per-command hint wins over the claim's own.
  const claimActive = (input?.phase === 'claimed' || input?.phase === 'submitting')
    && input.claim !== undefined && draft.startsWith(input.claim.token)
  const rawHint = claimActive && input.claim.hint !== undefined
    && draft.slice(input.claim.token.length).trim() === ''
    ? input.claim.hint
    : null
  const hint = ((): string | null => {
    if (rawHint === null) return null
    const commandName = input?.claim?.name ?? ''
    const hintKey = `hint.${commandName === 'goal' && hasGoal ? 'goal.active' : commandName}`
    // Dynamic lookup by claimed command name: unknown commands miss the
    // dictionary and keep the machine's own hint, so the call is wide.
    const translated = (t as Translate)(hintKey)
    return translated !== hintKey ? translated : rawHint
  })()

  const placeholderText = placeholder ?? (disabled
    ? t('placeholder.unavailable')
  // The steer hint deliberately outranks the plan placeholder:
  // while it shows, the whole-queue gesture is genuinely available
  // (the gate never consults plan mode), so the actionable hint wins.
    : canSteerQueue
      ? t('placeholder.steerQueue')
      : planActive ? t('placeholder.plan') : t('placeholder.default'))
  // Visual refresh T3.1: the visible placeholder teaches the sigils this composer really has (`@` files, skills and
  // threads through input-trigger; `/` commands). The accessible name keeps the long-standing default and hero
  // sentences, which journeys, the scratch seeder and assistive tech already address the box by.
  const sigilPlaceholder = placeholderText === t('placeholder.default') || placeholderText === t('placeholder.hero')
  const visiblePlaceholder = sigilPlaceholder ? t('placeholder.sigils') : placeholderText
  // Composer redesign b:v9yh: "Ask anything" plus a muted "@ mention · / commands" while the draft is empty; the
  // CSS drops the hint in narrow bars and on touch, where only "Ask anything" fits.
  const placeholderHint = sigilPlaceholder ? JSON.stringify(t('placeholder.hint')) : undefined

  // Hero: the pre-send choices (§4.5 of docs/ade-ux) ride inside the card's bottom bar as quiet ghost pickers
  // (visual refresh T3.2): project · host · workspace · agent mode · options · file access after the + control, the
  // model seat beside Send exactly where a started thread keeps it. Nothing sits above the input any more. Once the
  // thread has started the row collapses to the summary chip on the meter line and file access returns to the modes.
  const heroRunRow = variant === 'hero' && runRow !== undefined
  const queued = input?.queue.length ?? 0

  return (
    <div
      className={clsx(css.root, variant === 'hero' && css.hero)}
      data-shortcut-scope="composer"
      style={placeholderHint === undefined ? undefined : { '--dsh-composer-placeholder-hint': placeholderHint } as CSSProperties}
    >
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutlineRegular />}
          anchor={cardRef.current}
          onDone={dismissToast}
        />
      )}
      {notice?.level === 'info' && (
        <div className={css.notice} role="status">
          {notice.text}
        </div>
      )}
      {largePaste !== null && (
        <div className={clsx(css.notice, css.largePaste)} role="status">
          <span>{t('largePaste.attached', { name: largePaste.file.name })}</span>
          <button type="button" className={css.largePasteAction} onMouseDown={keepFocus} onClick={pasteLargeAsText}>
            {t('largePaste.asText')}
          </button>
        </div>
      )}
      {/* Trigger clicks land on the card, not the editor: the toolbar row's
          disabled controls swallow clicks otherwise (the CSS state disarms
          their pointer events), so the WHOLE capsule is the pick target.
          pointerdown stops here so the Menu's outside-close cannot race the
          click's reopen (close-then-open flickers the chip's open echo). */}
      <div
        ref={cardRef}
        tabIndex={-1}
        className={clsx(css.card, workspaceTrigger && css.cardWorkspaceTrigger)}
        data-composer-card
        onClick={workspaceTrigger ? onRequestWorkspace : undefined}
        onPointerDown={workspaceTrigger ? (e) => { e.stopPropagation() } : undefined}
        onMouseDown={onCardMouseDown}
      >
        {sessionId !== undefined && (
          <div className={css.overlayAnchor} data-composer-overlay>{renderSlot('conversation.input.overlay', {})}</div>
        )}
        {accessory !== undefined && <div className={css.accessory}>{accessory}</div>}
        {keyboard === undefined ? null : <AnnotationsPill annotations={keyboard.annotations} t={t} />}
        {renderSlot('conversation.input.attachments', {
          attachments,
          canAcceptDrop,
          onAddFiles: intakeFiles,
          onRemoveAttachment: (id) => { removeAttachment?.(id) },
          uploads,
          onRetryFile: (id) => { retryFileUpload?.(id) },
          uploadFailureText: reason => attachmentErrorText(t, reason, imageLimits),
          dropLimits: imageLimits === undefined ? undefined : {
            count: imageLimits.maxImagesPerMessage,
            size: imageSizeText(imageLimits.maxImageBytes),
          },
        })}
        {/* One scrollport, one text surface: the contenteditable grows with
            its content and .scroll — capped at 14 lines in CSS — is the only
            thing that scrolls. Chips are decorator portals inside the same
            surface, so wrapping, caret geometry, and scrolling are the
            browser's own. */}
        <DraftEditor
          classNames={css}
          editor={editor}
          scrollRef={scrollRef}
          editable={editable}
          editorDisabled={editorDisabled}
          phase={input?.phase ?? 'inert'}
          placeholderText={visiblePlaceholder}
          ariaLabel={workspaceTrigger ? t('hero.chooseWorkspace') : placeholderText}
          workspaceTrigger={workspaceTrigger}
          workspacePickerOpen={workspacePickerOpen}
          onWorkspaceKeyDown={onWorkspaceKeyDown}
          hint={hint}
          showPlaceholder={draft === '' && attachments.length === 0 && !claimActive}
        />
        <div ref={rowRef} className={clsx(css.row, heroRunRow && css.rowHero)}>
          <div className={css.tools} hidden={activity}>
            <Tooltip label={t('input.commands')} side="top" delayMs={500} portal>
              <button
                type="button"
                className={css.add}
                aria-label={t('input.commands')}
                aria-haspopup="listbox"
                aria-expanded={commandMenuOpen}
                disabled={locked || toggleCommandMenu === undefined}
                onMouseDown={keepFocus}
                onClick={onToggleCommandMenu}
              >
                <IconPlusOutlineMedium size={14} />
              </button>
            </Tooltip>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              disabled={!canAcceptDrop || subagent !== null}
              hidden
              onChange={onPickFiles}
            />
            {heroRunRow && (
              <div className={css.runRow} role="group" aria-label={t('runRow.label')} data-run-row="">
                {runRow}
                {sessionId === undefined ? null : (
                  <span className={css.runSegment} data-run-segment="file-access">
                    {renderSlot('conversation.input.permission', { locked })}
                  </span>
                )}
              </div>
            )}
            <div className={css.modes} data-mode-group="">
              {sessionId === undefined || heroRunRow ? null : renderSlot('conversation.input.permission', { locked })}
              {sessionId === undefined ? null : renderSlot('conversation.input.plan', { locked })}
            </div>
            {input === undefined || sessionId === undefined
              ? null
              : renderSlot('conversation.input.left', {})}
          </div>
          <div className={clsx(css.trailing, activity && css.trailingActive)}>
            <div className={css.standardControls} hidden={activity}>
              {input === undefined || sessionId === undefined
                ? null
                : renderSlot('conversation.input.right', {})}
              {sessionId === undefined ? null : (
                <span className={css.modelSeat} data-model-seat="" data-run-segment={heroRunRow ? 'model' : undefined}>
                  {renderSlot('conversation.input.model', { locked: modelSeatLocked })}
                </span>
              )}
            </div>
            {input === undefined || sessionId === undefined ? null : <div className={activity ? css.activityExpanded : css.activity}>
              {renderSlot('conversation.input.activity', { locked, onActiveChange: setActivity })}
            </div>}
            {/* The context meter rides beside Send (T3.3): a ring and percentage, its breakdown on click. */}
            {activity ? null : (
              <ContextMeter
                useProjection={useProjection}
                t={t}
                detail={input === undefined || sessionId === undefined ? null : renderSlot('conversation.composer.context', {})}
              />
            )}
            <div className={css.send}>
            {interruptible && !cancelDenied && (
              <Tooltip label={t('input.stop')} shortcutKeys={stopKeys} side="top" delayMs={500} disabled={stopAction === undefined} portal>
                <button
                  type="button"
                  className={css.primary}
                  aria-label={t('input.stop')}
                  disabled={stopAction === undefined}
                  onMouseDown={keepFocus}
                  onClick={stopAction}
                >
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                    <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
                  </svg>
                </button>
              </Tooltip>
            )}
            {(primaryStops ? cancelDenied : promptDenied) ? null : (
              <Tooltip label={sendTooltip} shortcutKeys={primaryStops ? stopKeys : undefined} side="top" delayMs={500} disabled={primaryDisabled} maxWidth={280} portal>
                <button
                  type="button"
                  className={css.primary}
                  aria-label={primaryLabel}
                  aria-busy={sending}
                  data-sending={sending ? '' : undefined}
                  disabled={primaryDisabled}
                  data-send-mode={sendMode}
                  onMouseDown={keepFocus}
                  onClick={onPrimary}
                >
                  {sendMode === 'sending' ? (
                    <svg className={css.sendingSpinner} viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
                      <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  ) : sendMode === 'continue' ? (
                    <IconTriangleRightFillRegular size={16} className={css.continueIcon} />
                  ) : <SendGlyph key={sendMode} mode={sendMode} />}
                </button>
              </Tooltip>
            )}
            </div>
          </div>
        </div>
      </div>
      {/* The meter line (composer follow-up b:gyk7): where the thread runs on the left (run summary, then the plugins'
          location entries such as "ahead of main by 2", then N queued), its readings on the right (activity, tokens,
          cost). The context reading is the ring in the bar, not repeated here. In a narrow bar only the left group
          shows; ⋯ lays the readings out on a second line. */}
      <div className={css.dock} data-composer-dock data-meter-line="" data-meter-expanded={metaExpanded ? '' : undefined}>
        {variant === 'composer' && runSummary !== undefined ? runSummary : null}
        {variant === 'composer' && input !== undefined && sessionId !== undefined
          ? renderSlot('conversation.composer.dock', {})
          : null}
        {variant === 'composer' && queued > 0 ? (
          <span className={css.queued} data-meter="queued">{t('runRow.queued', { count: String(queued) })}</span>
        ) : null}
        {variant === 'composer' ? <span className={css.meterSpacer} aria-hidden /> : null}
        {variant === 'composer' ? (
          <button
            type="button"
            className={css.meterMore}
            aria-expanded={metaExpanded}
            aria-label={metaExpanded ? t('runRow.lessDetails') : t('runRow.moreDetails')}
            data-meter-more=""
            onClick={() => { setMetaExpanded(open => !open) }}
          >
            ⋯
          </button>
        ) : null}
      </div>
    </div>
  )
})

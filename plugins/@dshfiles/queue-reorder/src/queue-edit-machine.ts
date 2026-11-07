import { assign, fromCallback, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import { QueueEditModel, type QueueEditPorts, type QueueEditRecord, type QueuedBlock, type QueuedRow } from './queue-edit-model.js'

/**
 * The queued-message edit lifecycle as one machine.
 *
 * Taking the original out of the queue, waiting for its replacement to surface, and putting it back are three
 * asynchronous sequences that used to share a persisted `status` field, a `placing` Set, detached timers and a
 * `loading` flag. Here the state value is the status: the record only carries what survives a reload, so no
 * combination such as "restoring while placing" can be written.
 *
 * The records port stays the persistence boundary: every state that changes what a reload should do saves the record
 * it would need to resume.
 */

export interface QueueEditMachineInput<DraftId extends string, Attachment> {
  readonly ports: QueueEditPorts<DraftId, Attachment>
}

interface EditContext<DraftId extends string, Attachment> {
  readonly ports: QueueEditPorts<DraftId, Attachment>
  /** What a reload resumes from; `status` matches the state that saved it. */
  record: QueueEditRecord | null
  /** The queued message the edit took out. */
  row: QueuedRow | null
  /** Its attachment bytes, read before the removal. */
  files: File[]
  /** Browser-only: file bytes read once, so Cancel after a reload can re-upload them. */
  fileCache: Map<string, File>
  /** The composer attachments the edit displaced. */
  backupIds: readonly DraftId[]
  /** Pending request ids as of the last pending-list change. */
  knownPending: readonly string[]
  /** Submissions that left the pending list and still need a verdict. */
  retired: readonly string[]
  notice: string | null
  /** The queued row being moved into its remembered position. */
  placementItem: string | null
  /** True when this resume is landing a restore, which reports an interruption instead of forgetting it. */
  resumedRestore: boolean
}

type EditEvent =
  | { readonly type: 'BEGIN'; readonly row: QueuedRow }
  | { readonly type: 'SUBMIT' }
  | { readonly type: 'CANCEL' }
  | { readonly type: 'DISCARD' }
  | { readonly type: 'DISMISS_NOTICE' }
  | { readonly type: 'QUEUE_CHANGED' }
  | { readonly type: 'PENDING_CHANGED' }

const readBlocks = async <DraftId extends string, Attachment>(input: {
  readonly ports: QueueEditPorts<DraftId, Attachment>
  readonly blocks: readonly QueuedBlock[]
  readonly cache: Map<string, File>
}): Promise<File[]> =>
  Promise.all(
    input.blocks.flatMap(block => {
      if (block.type === 'text') return []
      const cached = input.cache.get(block.attachment.attachmentId)
      if (cached !== undefined) return [Promise.resolve(cached)]
      const read = block.type === 'image' ? input.ports.host.readImage(block.attachment) : input.ports.host.readFile(block.attachment)
      return [
        read.then(file => {
          input.cache.set(block.attachment.attachmentId, file)
          return file
        }),
      ]
    }),
  )

/** Bounded: each step moves one position, and a refused step answers with an unchanged index. */
const moveIntoPlace = async <DraftId extends string, Attachment>(input: {
  readonly ports: QueueEditPorts<DraftId, Attachment>
  readonly itemId: string
  readonly before: readonly string[]
}): Promise<void> => {
  const rows = input.ports.queue.getSnapshot()
  let index = rows.findIndex(row => row.id === input.itemId)
  if (index < 0) return
  const target = QueueEditModel.restoredIndex({ rows, before: input.before, itemId: input.itemId })
  for (let step = 0; step <= rows.length && index !== target; step += 1) {
    const next = await input.ports.host.move(input.itemId, index > target ? 'up' : 'down')
    if (next === index) return
    index = next
  }
}

export const createQueueEditMachine = <DraftId extends string, Attachment>() =>
  // SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
  setup({
    types: {
      context: {} as EditContext<DraftId, Attachment>,
      events: {} as EditEvent,
      input: {} as QueueEditMachineInput<DraftId, Attachment>,
    },
    guards: {
      rowNotEditable: ({ event }) => event.type === 'BEGIN' && !event.row.editable,
      composerBusy: ({ context }) => !context.ports.composer.getSnapshot().idle,
      rowStillQueued: ({ context }) => context.row !== null && context.ports.queue.getSnapshot().some(row => row.id === context.row?.id),
      hasFreshSubmission: ({ context }) =>
        context.record !== null &&
        context.ports.pendingRequestIds.getSnapshot().some(id => !context.knownPending.includes(id) && !context.record?.submissions.includes(id)),
      pendingChanged: ({ context }) => {
        if (context.record === null) return false
        const current = context.ports.pendingRequestIds.getSnapshot()
        return (
          current.some(id => !context.knownPending.includes(id) && !context.record?.submissions.includes(id)) ||
          context.knownPending.some(id => !current.includes(id) && context.record?.submissions.includes(id) === true)
        )
      },
      hasQueuedSubmission: ({ context }) =>
        context.record !== null &&
        context.ports.queue.getSnapshot().some(row => row.rpcId !== undefined && context.record?.submissions.includes(row.rpcId) === true),
      hasRetired: ({ context }) => context.retired.length > 0,
      retiredInQueue: ({ context }) => context.ports.queue.getSnapshot().some(row => row.rpcId !== undefined && context.retired.includes(row.rpcId)),
      retiredDelivered: ({ context }) => {
        const composer = context.ports.composer.getSnapshot()
        const queued = context.ports.queue.getSnapshot().some(row => row.rpcId !== undefined && context.retired.includes(row.rpcId))
        return !queued && composer.draft.trim().length === 0 && composer.attachmentIds.length === 0
      },
      restoreRowQueued: ({ context }) => context.ports.queue.getSnapshot().some(row => row.rpcId === context.record?.restoreRequestId),
      restoreResumed: ({ context }) => context.resumedRestore,
      needsHydration: ({ context }) => {
        const record = context.record
        if (record === null) return false
        return context.ports.composer.getSnapshot().attachmentIds.length === 0 && record.blocks.some(block => block.type !== 'text')
      },
      resumedEditing: ({ context }) => context.record?.status === 'editing',
      resumedSubmitting: ({ context }) => context.record?.status === 'submitting',
      resumedRestoring: ({ context }) => context.record?.status === 'restoring',
      resumedFailed: ({ context }) => context.record?.status === 'failed',
    },
    actions: {
      notifyNotEditable: assign({ notice: 'This queued message holds content the composer cannot edit.' }),
      notifyComposerBusy: assign({ notice: 'Wait for the composer to finish sending, then edit.' }),
      notifyBusy: assign({ notice: 'Finish the queued message you are editing first.' }),
      notifyLeftQueue: assign({ notice: 'This message already left the queue.' }),
      clearRecord: assign({ record: null }),
      save: ({ context }) => context.ports.records.save(context.record),
      resetKnownPending: assign({ knownPending: ({ context }) => [...context.ports.pendingRequestIds.getSnapshot()] }),
      prepareRecord: assign(({ context }): Partial<EditContext<DraftId, Attachment>> => {
        const row = context.row
        if (row === null) return {}
        const rows = context.ports.queue.getSnapshot()
        const index = rows.findIndex(candidate => candidate.id === row.id)
        if (index < 0) return {}
        const composer = context.ports.composer.getSnapshot()
        return {
          backupIds: [...composer.attachmentIds],
          knownPending: [...context.ports.pendingRequestIds.getSnapshot()],
          record: {
            itemId: row.id,
            blocks: [...row.blocks],
            before: rows.slice(0, index).map(candidate => candidate.id),
            backupDraft: composer.draft,
            status: 'editing',
            submissions: [],
            composerRestored: false,
          },
        }
      }),
      adoptComposerForEdit: assign(({ context }): Partial<EditContext<DraftId, Attachment>> => {
        const composer = context.ports.composer
        for (const id of context.backupIds) composer.removeAttachment(id)
        const text = QueueEditModel.textOf(context.row?.blocks ?? [])
        composer.setDraft(text)
        const hydrated = context.ports.drafts.create(context.files)
        let notice: string | null = null
        if (hydrated.length > 0 && !composer.addAttachments(hydrated)) {
          context.ports.drafts.release(hydrated)
          notice = 'The composer refused the attachments; Cancel still puts the original back.'
        } else {
          composer.restoreImageReferences({
            text,
            imageIds: QueueEditModel.imageIdsForBlocks({ blocks: context.row?.blocks ?? [], attachmentIds: hydrated }),
          })
        }
        composer.focus()
        return { notice }
      }),
      absorbPending: assign(({ context }): Partial<EditContext<DraftId, Attachment>> => {
        const record = context.record
        if (record === null) return {}
        const current = [...context.ports.pendingRequestIds.getSnapshot()]
        const fresh = current.filter(id => !context.knownPending.includes(id) && !record.submissions.includes(id))
        const retired = context.knownPending.filter(id => !current.includes(id) && record.submissions.includes(id) && !context.retired.includes(id))
        return {
          knownPending: current,
          retired: [...context.retired, ...retired],
          record: fresh.length === 0 ? record : { ...record, status: 'submitting', submissions: [...record.submissions, ...fresh], error: undefined },
        }
      }),
      markSubmitting: assign(({ context }): Partial<EditContext<DraftId, Attachment>> => ({
        record: context.record === null ? null : { ...context.record, status: 'submitting', error: undefined },
      })),
      assignPlacement: assign(({ context }): Partial<EditContext<DraftId, Attachment>> => ({
        placementItem:
          context.ports.queue.getSnapshot().find(row => row.rpcId !== undefined && context.record?.submissions.includes(row.rpcId) === true)?.id ?? null,
      })),
      rejectRetired: assign(({ context }): Partial<EditContext<DraftId, Attachment>> => ({
        retired: [],
        record:
          context.record === null
            ? null
            : {
                ...context.record,
                status: 'editing',
                submissions: context.record.submissions.filter(id => !context.retired.includes(id)),
                error: 'Submit did not go through; your edit is still in the composer.',
              },
      })),
      restoreComposerBackup: ({ context }) => {
        const record = context.record
        if (record === null) return
        if (context.ports.composer.getSnapshot().draft.trim().length === 0 && record.backupDraft.length > 0) {
          context.ports.composer.setDraft(record.backupDraft)
        }
        const live = context.ports.drafts.live(context.backupIds)
        if (live.length > 0) context.ports.composer.addAttachments(live)
      },
      beginRestoreComposer: assign(({ context }): Partial<EditContext<DraftId, Attachment>> => {
        const record = context.record
        if (record === null) return {}
        if (record.composerRestored) return { record: { ...record, status: 'restoring', error: undefined } }
        const edited = context.ports.composer.getSnapshot().attachmentIds
        for (const id of edited) context.ports.composer.removeAttachment(id)
        context.ports.drafts.release(edited)
        context.ports.composer.setDraft('')
        if (context.ports.composer.getSnapshot().draft.trim().length === 0 && record.backupDraft.length > 0) {
          context.ports.composer.setDraft(record.backupDraft)
        }
        const live = context.ports.drafts.live(context.backupIds)
        if (live.length > 0) context.ports.composer.addAttachments(live)
        return {
          backupIds: [],
          record: { ...record, status: 'restoring', composerRestored: true, error: undefined },
        }
      }),
      assignRestorePlacement: assign(({ context }): Partial<EditContext<DraftId, Attachment>> => ({
        placementItem: context.ports.queue.getSnapshot().find(row => row.rpcId === context.record?.restoreRequestId)?.id ?? null,
      })),
    },
    actors: {
      ports: fromCallback<EditEvent, { readonly ports: QueueEditPorts<DraftId, Attachment> }>(({ input, sendBack }) => {
        const stops = [
          input.ports.queue.subscribe(() => sendBack({ type: 'QUEUE_CHANGED' })),
          input.ports.pendingRequestIds.subscribe(() => sendBack({ type: 'PENDING_CHANGED' })),
        ]
        return () => {
          for (const stop of stops) stop()
        }
      }),
      readFiles: fromPromise<
        File[],
        { readonly ports: QueueEditPorts<DraftId, Attachment>; readonly blocks: readonly QueuedBlock[]; readonly cache: Map<string, File> }
      >(({ input }) => readBlocks(input)),
      removeRow: fromPromise<void, { readonly ports: QueueEditPorts<DraftId, Attachment>; readonly itemId: string }>(({ input }) =>
        input.ports.host.remove(input.itemId),
      ),
      restoreOriginal: fromPromise<
        string,
        { readonly ports: QueueEditPorts<DraftId, Attachment>; readonly blocks: readonly QueuedBlock[]; readonly cache: Map<string, File> }
      >(async ({ input }) => {
        const draftIds = input.ports.drafts.create(await readBlocks(input))
        try {
          return await input.ports.host.enqueue(QueueEditModel.promptPartsFor(input.blocks, await input.ports.drafts.serialize(draftIds)))
        } finally {
          if (draftIds.length > 0) input.ports.drafts.release(draftIds)
        }
      }),
      hydrateAttachments: fromPromise<
        void,
        { readonly ports: QueueEditPorts<DraftId, Attachment>; readonly blocks: readonly QueuedBlock[]; readonly cache: Map<string, File> }
      >(async ({ input }) => {
        const hydrated = input.ports.drafts.create(await readBlocks(input))
        if (hydrated.length > 0 && !input.ports.composer.addAttachments(hydrated)) {
          input.ports.drafts.release(hydrated)
          return
        }
        input.ports.composer.restoreImageReferences({
          text: QueueEditModel.textOf(input.blocks),
          imageIds: QueueEditModel.imageIdsForBlocks({ blocks: input.blocks, attachmentIds: hydrated }),
        })
      }),
      place: fromPromise<void, { readonly ports: QueueEditPorts<DraftId, Attachment>; readonly itemId: string; readonly before: readonly string[] }>(
        ({ input }) => moveIntoPlace({ ports: input.ports, itemId: input.itemId, before: input.before }),
      ),
    },
    delays: {
      settle: ({ context }) => context.ports.settleDelayMs ?? 600,
      placement: ({ context }) => context.ports.placementTimeoutMs ?? 10_000,
    },
  }).createMachine({
    id: 'queueEdit',
    context: ({ input }) => ({
      ports: input.ports,
      record: input.ports.records.load(),
      row: null,
      files: [],
      fileCache: new Map(),
      backupIds: [],
      knownPending: [...input.ports.pendingRequestIds.getSnapshot()],
      retired: [],
      notice: null,
      placementItem: null,
      resumedRestore: false,
    }),
    initial: 'boot',
    invoke: { id: 'ports', src: 'ports', input: ({ context }) => ({ ports: context.ports }) },
    on: {
      DISMISS_NOTICE: { actions: assign({ notice: null }) },
      BEGIN: { actions: 'notifyBusy' },
    },
    states: {
      boot: {
        always: [
          { guard: 'resumedEditing', target: '#queueEdit.hydrating' },
          { guard: 'resumedSubmitting', target: '#queueEdit.submitting', actions: assign({ retired: ({ context }) => context.record?.submissions ?? [] }) },
          { guard: 'resumedRestoring', target: '#queueEdit.restore.waitingQueued', actions: assign({ resumedRestore: true }) },
          { guard: 'resumedFailed', target: '#queueEdit.failed' },
          { target: '#queueEdit.idle' },
        ],
      },
      idle: {
        on: {
          BEGIN: [
            { guard: 'rowNotEditable', actions: 'notifyNotEditable' },
            { guard: 'composerBusy', actions: 'notifyComposerBusy' },
            {
              target: '#queueEdit.loading.reading',
              actions: assign({ row: ({ event }) => event.row, notice: null, files: [], retired: [], placementItem: null }),
            },
          ],
        },
      },
      loading: {
        initial: 'reading',
        states: {
          reading: {
            invoke: {
              src: 'readFiles',
              input: ({ context }) => ({ ports: context.ports, blocks: context.row?.blocks ?? [], cache: context.fileCache }),
              onDone: [
                { guard: 'rowStillQueued', target: '#queueEdit.loading.removing', actions: assign({ files: ({ event }) => event.output }) },
                { target: '#queueEdit.idle', actions: 'notifyLeftQueue' },
              ],
              onError: {
                target: '#queueEdit.idle',
                actions: assign({
                  notice: ({ event }) => `Could not load this message's attachments (${QueueEditModel.messageOf(event.error)}). It stays queued.`,
                }),
              },
            },
          },
          removing: {
            entry: ['prepareRecord', 'save'],
            invoke: {
              src: 'removeRow',
              input: ({ context }) => ({ ports: context.ports, itemId: context.row?.id ?? '' }),
              onDone: { target: '#queueEdit.editing', actions: 'adoptComposerForEdit' },
              onError: { target: '#queueEdit.idle', actions: ['clearRecord', 'save', 'notifyLeftQueue'] },
            },
          },
        },
      },
      hydrating: {
        invoke: {
          src: 'hydrateAttachments',
          input: ({ context }) => ({ ports: context.ports, blocks: context.record?.blocks ?? [], cache: context.fileCache }),
          onDone: { target: '#queueEdit.editing' },
          onError: {
            target: '#queueEdit.editing',
            actions: assign({ notice: "Could not reload this message's attachments into the composer; Cancel still puts the original back." }),
          },
        },
      },
      editing: {
        on: {
          SUBMIT: { actions: ({ context }) => context.ports.composer.submit() },
          PENDING_CHANGED: { guard: 'hasFreshSubmission', target: '#queueEdit.submitting' },
          CANCEL: { target: '#queueEdit.restore.restoring' },
        },
      },
      submitting: {
        entry: ['absorbPending', 'markSubmitting', 'save'],
        after: { settle: { guard: 'hasRetired', target: '#queueEdit.judging' } },
        on: {
          PENDING_CHANGED: { guard: 'pendingChanged', target: '#queueEdit.submitting', reenter: true },
          QUEUE_CHANGED: { guard: 'hasQueuedSubmission', target: '#queueEdit.placing', actions: 'assignPlacement' },
        },
      },
      judging: {
        always: [
          { guard: 'retiredInQueue', target: '#queueEdit.placing', actions: 'assignPlacement' },
          { guard: 'retiredDelivered', target: '#queueEdit.idle', actions: ['restoreComposerBackup', 'clearRecord', 'save'] },
          { target: '#queueEdit.editing', actions: 'rejectRetired' },
        ],
      },
      placing: {
        invoke: {
          src: 'place',
          input: ({ context }) => ({ ports: context.ports, itemId: context.placementItem ?? '', before: context.record?.before ?? [] }),
          onDone: { target: '#queueEdit.idle', actions: ['restoreComposerBackup', 'clearRecord', 'save'] },
          onError: { target: '#queueEdit.idle', actions: ['restoreComposerBackup', 'clearRecord', 'save'] },
        },
      },
      restore: {
        initial: 'restoring',
        states: {
          restoring: {
            entry: ['beginRestoreComposer', 'save'],
            invoke: {
              src: 'restoreOriginal',
              input: ({ context }) => ({ ports: context.ports, blocks: context.record?.blocks ?? [], cache: context.fileCache }),
              onDone: {
                target: '#queueEdit.restore.waitingQueued',
                actions: [
                  assign({
                    resumedRestore: false,
                    record: ({ context, event }) => (context.record === null ? null : { ...context.record, restoreRequestId: event.output }),
                  }),
                  'resetKnownPending',
                  'save',
                ],
              },
              onError: {
                target: '#queueEdit.failed',
                actions: [
                  assign({
                    record: ({ context, event }) =>
                      context.record === null
                        ? null
                        : {
                            ...context.record,
                            status: 'failed',
                            error: `Could not put the original message back (${QueueEditModel.messageOf(event.error)}). Retry or discard it.`,
                          },
                  }),
                  'save',
                ],
              },
            },
          },
          waitingQueued: {
            always: { guard: 'restoreRowQueued', target: '#queueEdit.restore.placing', actions: 'assignRestorePlacement' },
            after: {
              placement: [
                {
                  guard: 'restoreResumed',
                  target: '#queueEdit.failed',
                  actions: [
                    assign({
                      record: ({ context }) =>
                        context.record === null
                          ? null
                          : {
                              ...context.record,
                              status: 'failed',
                              error: 'Putting the original back was interrupted. Check the queue, then retry or discard it.',
                            },
                    }),
                    'save',
                  ],
                },
                { target: '#queueEdit.idle', actions: ['clearRecord', 'save'] },
              ],
            },
            on: {
              QUEUE_CHANGED: { guard: 'restoreRowQueued', target: '#queueEdit.restore.placing', actions: 'assignRestorePlacement' },
            },
          },
          placing: {
            invoke: {
              src: 'place',
              input: ({ context }) => ({ ports: context.ports, itemId: context.placementItem ?? '', before: context.record?.before ?? [] }),
              onDone: { target: '#queueEdit.idle', actions: ['clearRecord', 'save'] },
              onError: { target: '#queueEdit.idle', actions: ['clearRecord', 'save'] },
            },
          },
        },
      },
      failed: {
        on: {
          CANCEL: { target: '#queueEdit.restore.restoring' },
          DISCARD: { target: '#queueEdit.idle', actions: ['clearRecord', 'save'] },
        },
      },
    },
  })

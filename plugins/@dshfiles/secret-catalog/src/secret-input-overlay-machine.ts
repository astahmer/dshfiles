import { assign, setup } from '@dshfiles/plugin-ui/machine'
import { SecretSetupSteps, type SecretSetupStep } from './secret-setup-step.js'

type Field = HTMLInputElement | HTMLTextAreaElement

export interface FieldAnchor {
  readonly element: Field
  readonly rect: DOMRect
}

/** The create-and-bind form shown for one field, kept while the panel is closed so a failed bind can be retried. */
interface CreateState {
  readonly element: Field
  readonly step: SecretSetupStep
}

interface OverlayContext {
  readonly anchor: FieldAnchor | null
  readonly create: CreateState | null
  /** The last unresolved reference that auto-opened the panel: each reference opens the panel at most once. */
  readonly autoOpened: string | null
}

type OverlayEvent =
  | { readonly type: 'focus'; readonly anchor: FieldAnchor | null }
  | { readonly type: 'measure'; readonly anchor: FieldAnchor | null }
  | { readonly type: 'create'; readonly anchor: FieldAnchor }
  | { readonly type: 'toggle'; readonly jevField: boolean }
  | { readonly type: 'open.create' }
  | { readonly type: 'open.jev' }
  | { readonly type: 'cancel.create' }
  | { readonly type: 'blur' }
  | { readonly type: 'pick' }
  | { readonly type: 'step'; readonly step: SecretSetupStep }
  | { readonly type: 'bound' }
  | { readonly type: 'jev.pending'; readonly pending: boolean }
  | { readonly type: 'jev.cancel' }
  | { readonly type: 'jev.saved' }
  | { readonly type: 'reference.unresolved'; readonly reference: string }

const sameElement = (left: Field | null, right: Field | null): boolean => left !== null && left === right

const keepCreateFor = (create: CreateState | null, element: Field): CreateState | null => (sameElement(create?.element ?? null, element) ? create : null)

/**
 * The Secret Catalog offered on a `data-secret-input="reference"` field: the panel is closed while the field has
 * focus, opens on the picker button or on an unresolved reference, and shows either the alias list, the
 * create-and-bind form or the Jev key setup. A key being saved is a state of its own, so focus, blur and the picker
 * button cannot close the panel over that save.
 */
// SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
export const secretInputOverlayMachine = setup({
  types: {
    context: {} as OverlayContext,
    events: {} as OverlayEvent,
  },
}).createMachine({
  id: 'secretInputOverlay',
  context: { anchor: null, create: null, autoOpened: null },
  initial: 'detached',
  on: {
    measure: { actions: assign({ anchor: ({ event }) => event.anchor }) },
  },
  states: {
    detached: {
      on: {
        focus: [
          { guard: ({ event }) => event.anchor === null },
          {
            target: 'closed',
            actions: assign(({ context, event }) => ({
              anchor: event.anchor,
              create: event.anchor === null ? null : keepCreateFor(context.create, event.anchor.element),
            })),
          },
        ],
        create: {
          target: 'create',
          actions: assign(({ context, event }) => ({
            anchor: event.anchor,
            create: keepCreateFor(context.create, event.anchor.element) ?? { element: event.anchor.element, step: SecretSetupSteps.draft() },
          })),
        },
      },
    },
    closed: {
      on: {
        focus: [
          { guard: ({ event }) => event.anchor === null },
          {
            actions: assign(({ context, event }) => ({
              anchor: event.anchor,
              create: event.anchor === null ? null : keepCreateFor(context.create, event.anchor.element),
            })),
          },
        ],
        create: {
          target: 'create',
          actions: assign(({ context, event }) => ({
            anchor: event.anchor,
            create: keepCreateFor(context.create, event.anchor.element) ?? { element: event.anchor.element, step: SecretSetupSteps.draft() },
          })),
        },
        toggle: [{ guard: ({ event }) => event.jevField, target: 'jevSetup.editing' }, { target: 'list' }],
        blur: { target: 'detached', actions: assign({ anchor: null }) },
        'reference.unresolved': {
          guard: ({ context, event }) => context.autoOpened !== event.reference,
          target: 'list',
          actions: assign(({ event }) => ({ autoOpened: event.reference })),
        },
      },
    },
    list: {
      on: {
        focus: [
          { guard: ({ event }) => event.anchor === null },
          {
            target: 'closed',
            actions: assign(({ context, event }) => ({
              anchor: event.anchor,
              create: event.anchor === null ? null : keepCreateFor(context.create, event.anchor.element),
            })),
          },
        ],
        blur: { target: 'detached', actions: assign({ anchor: null }) },
        create: {
          target: 'create',
          actions: assign(({ context, event }) => ({
            anchor: event.anchor,
            create: keepCreateFor(context.create, event.anchor.element) ?? { element: event.anchor.element, step: SecretSetupSteps.draft() },
          })),
        },
        toggle: { target: 'closed' },
        'open.create': { target: 'create' },
        'open.jev': { target: 'jevSetup.editing' },
        pick: { target: 'closed', actions: assign({ create: null }) },
        'reference.unresolved': { actions: assign(({ context, event }) => (context.autoOpened === event.reference ? {} : { autoOpened: event.reference })) },
      },
    },
    create: {
      on: {
        focus: [
          { guard: ({ event }) => event.anchor === null },
          {
            target: 'closed',
            actions: assign(({ context, event }) => ({
              anchor: event.anchor,
              create: event.anchor === null ? null : keepCreateFor(context.create, event.anchor.element),
            })),
          },
        ],
        blur: { target: 'detached', actions: assign({ anchor: null }) },
        create: {
          actions: assign(({ context, event }) => ({
            anchor: event.anchor,
            create: keepCreateFor(context.create, event.anchor.element) ?? { element: event.anchor.element, step: SecretSetupSteps.draft() },
          })),
        },
        step: {
          actions: assign(({ context, event }) => (context.create === null ? {} : { create: { ...context.create, step: event.step } })),
        },
        'cancel.create': { target: 'list' },
        bound: { target: 'closed', actions: assign({ create: null }) },
      },
    },
    jevSetup: {
      on: {
        'jev.saved': { target: 'detached', actions: assign({ anchor: null, create: null }) },
      },
      initial: 'editing',
      states: {
        editing: {
          on: {
            focus: [
              { guard: ({ event }) => event.anchor === null },
              {
                target: '#secretInputOverlay.closed',
                actions: assign(({ context, event }) => ({
                  anchor: event.anchor,
                  create: event.anchor === null ? null : keepCreateFor(context.create, event.anchor.element),
                })),
              },
            ],
            blur: { target: '#secretInputOverlay.detached', actions: assign({ anchor: null }) },
            create: {
              target: '#secretInputOverlay.create',
              actions: assign(({ context, event }) => ({
                anchor: event.anchor,
                create: keepCreateFor(context.create, event.anchor.element) ?? { element: event.anchor.element, step: SecretSetupSteps.draft() },
              })),
            },
            toggle: { target: '#secretInputOverlay.closed' },
            'jev.cancel': { target: '#secretInputOverlay.list' },
            'jev.pending': [{ guard: ({ event }) => event.pending, target: 'saving' }, {}],
          },
        },
        saving: {
          on: {
            'jev.pending': [{ guard: ({ event }) => !event.pending, target: 'editing' }],
          },
        },
      },
    },
  },
})

/**
 * The one mention and entity registry (plan `plans/ade-ux` §5 `entityProvider`, §6 "7 `@` sources, 3 preview overlays").
 *
 * Every plugin that knows a kind of thing a user can mention or reference (an agent, a backlog item, a memory note, an
 * MCP server, a skill, a thread or file) adds one `EntityKinds` item. Input-trigger, which owns the `@` engine every
 * composer uses, then:
 *
 * - registers that kind's `@` source with the `inputTriggers` service, so every `@` group goes through this registry;
 * - publishes the scope prefixes each kind owns (`@b:`, `@skill:`), so a source stays empty while another kind's scope
 *   is typed without hard-coding the other plugins;
 * - renders the one reference-preview card: a reference link anywhere calls `EntityPreview.request(...)`, and the shared
 *   overlay positions the card, follows the reference while the page scrolls, and draws the providing kind's `Preview`
 *   body inside it.
 *
 * Published as the `@dshfiles/input-trigger/entity-registry` dshx module. It imports no React at runtime and no
 * provider, so providers depend on input-trigger and never the reverse (docs/plugin-boundaries.md). Without
 * input-trigger nothing renders the registry, so a provider's `@` group and card simply do not show.
 */
import { defineRegistry } from '@dshfiles/dshx/client'
import type { ComponentType } from 'react'

import type { InputTriggerSource } from './types.js'

/** What the shared card hands a kind's preview body. */
export interface EntityPreviewProps {
  /** The referenced id as the provider wrote it into the request (`luna`, `12`, `n:4`). */
  readonly id: string
  /** An optional sub-range (a memory excerpt's event range). */
  readonly range?: string | undefined
  /** Closes the card, e.g. after an action that navigates away. */
  readonly close: () => void
}

export interface EntityKind {
  /** Stable kind id (`agent`, `backlog`, `memory`, `mcp`, `skill`, `reference`); the first item per kind wins. */
  readonly kind: string
  /** Singular noun for assistive technology and the card's accessible name ("Agent", "Backlog item"). */
  readonly label: string
  /** Lower first; ties keep registration order. Decides the order `@` groups register in. */
  readonly order?: number
  /**
   * The `@` scope prefixes this kind owns, without the colon (`['b', 'backlog']`). Another kind's source returns no rows
   * while one of them is typed, so each scope lists one kind.
   */
  readonly mentionPrefixes?: readonly string[]
  /** The kind's `@` source. Input-trigger registers it with the `inputTriggers` service; keep its `name` stable. */
  readonly mentionSource?: InputTriggerSource
  /**
   * The card body for one reference of this kind. Bind it with `api.bind(...)` (or render it inside the provider's own
   * `PluginQueryProvider`) so its hooks read the providing plugin's context. The shared card owns the popover, its
   * position, scroll tracking and width; the body owns its header, content and actions.
   */
  readonly Preview?: ComponentType<EntityPreviewProps>
  /**
   * A headless component the shared overlay keeps mounted while this kind is registered, for work that needs the
   * provider's hooks: decorating references in the transcript as links, for example. It renders null.
   */
  readonly Decorations?: ComponentType
  /** Card width: `wide` (34rem) suits Markdown bodies and excerpts, `default` is 30rem. */
  readonly previewWidth?: 'default' | 'wide' | ((request: { readonly id: string; readonly range?: string | undefined }) => 'default' | 'wide')
}

/** Plugins contribute with `plugin.add(EntityKinds, { kind, label, mentionPrefixes, mentionSource, Preview })`. */
export const EntityKinds = defineRegistry<EntityKind>('@dshfiles/input-trigger.entity-kind')

/** One item per kind (the first registered wins), sorted by order, then registration order. */
const arrange = (items: readonly EntityKind[]): readonly EntityKind[] => {
  const seen = new Set<string>()
  const unique: { readonly item: EntityKind; readonly index: number }[] = []
  for (const [index, item] of items.entries()) {
    if (seen.has(item.kind)) continue
    seen.add(item.kind)
    unique.push({ item, index })
  }
  return unique.sort((left, right) => (left.item.order ?? 0) - (right.item.order ?? 0) || left.index - right.index).map(entry => entry.item)
}

/**
 * The kind whose scope a typed `@` query opens, or undefined for an unscoped query. Prefixes match case-insensitively
 * and need their colon: `@b:12` opens `backlog`, `@b12` opens nothing.
 */
const scopeOwner = (items: readonly EntityKind[], query: string): string | undefined => {
  const lower = query.toLowerCase()
  for (const item of arrange(items)) {
    for (const prefix of item.mentionPrefixes ?? []) {
      if (prefix !== '' && lower.startsWith(`${prefix.toLowerCase()}:`)) return item.kind
    }
  }
  return undefined
}

/** True when `query` opens a scope that belongs to a kind other than `kind`: that kind's source should list nothing. */
const foreignScope = (items: readonly EntityKind[], kind: string, query: string): boolean => {
  const owner = scopeOwner(items, query)
  return owner !== undefined && owner !== kind
}

export class EntityRegistryModel {
  static readonly arrange = arrange
  static readonly scopeOwner = scopeOwner
  static readonly foreignScope = foreignScope
}

export interface EntityAnchorRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** One request for the shared card, as `EntityPreview.request` dispatches it. */
export interface EntityPreviewRequest {
  readonly kind: string
  readonly id: string
  readonly range?: string | undefined
  /** The decorated element the card follows: it re-measures this anchor instead of closing when the page scrolls. */
  readonly anchorId: number
  readonly anchor: EntityAnchorRect
}

export type EntityAnchorMeasurement =
  | { readonly kind: 'rect'; readonly rect: EntityAnchorRect }
  /** The reference scrolled past the viewport, so the card has nothing to point at. */
  | { readonly kind: 'offscreen' }
  | { readonly kind: 'gone' }

const PREVIEW_EVENT = 'dshfiles:entity-preview'
const ANCHOR_ATTRIBUTE = 'data-dshfiles-entity-anchor'
const MAX_ID_CHARS = 512
const MAX_KIND_CHARS = 64
const COORDINATE_LIMIT = 100_000
let nextAnchor = 1

const anchorIdOf = (element: Element): number => {
  const existing = element.getAttribute(ANCHOR_ATTRIBUTE)
  const parsed = existing === null ? Number.NaN : Number(existing)
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed
  const id = nextAnchor++
  element.setAttribute(ANCHOR_ATTRIBUTE, String(id))
  return id
}

const measure = (anchorId: number, viewportHeight: number): EntityAnchorMeasurement => {
  const element = document.querySelector(`[${ANCHOR_ATTRIBUTE}="${String(anchorId)}"]`)
  if (element === null) return { kind: 'gone' }
  const rect = element.getBoundingClientRect()
  if (rect.bottom < 0 || rect.top > viewportHeight) return { kind: 'offscreen' }
  return { kind: 'rect', rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } }
}

/** A page event's fields as sent; each stays unparsed until checked below. */
interface PreviewRequestData {
  readonly kind?: unknown
  readonly id?: unknown
  readonly range?: unknown
  readonly anchorId?: unknown
  readonly anchor?: unknown
}

/** The anchor box a page event carries. */
interface AnchorData {
  readonly left?: unknown
  readonly top?: unknown
  readonly width?: unknown
  readonly height?: unknown
}

/** A plain object (not an array): a page event and its anchor box. */
const isFields = (value: unknown): value is object => typeof value === 'object' && value !== null && !Array.isArray(value)
const boundedText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
const coordinate = (value: unknown, min: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= COORDINATE_LIMIT

/** Decodes one page event; anything malformed or out of range discards it. */
const decodeRequest = (value: unknown): EntityPreviewRequest | null => {
  const fields: PreviewRequestData | null = isFields(value) ? value : null
  if (fields === null || !isFields(fields.anchor)) return null
  const { kind, id, range, anchorId } = fields
  const anchor: AnchorData = fields.anchor
  if (!boundedText(kind, MAX_KIND_CHARS) || !boundedText(id, MAX_ID_CHARS)) return null
  if (range !== undefined && !boundedText(range, MAX_ID_CHARS)) return null
  if (typeof anchorId !== 'number' || !Number.isSafeInteger(anchorId) || anchorId <= 0) return null
  const { left, top, width, height } = anchor
  if (!coordinate(left, -COORDINATE_LIMIT) || !coordinate(top, -COORDINATE_LIMIT) || !coordinate(width, 0) || !coordinate(height, 0)) return null
  const box = { left, top, width, height }
  return range === undefined ? { kind, id, anchorId, anchor: box } : { kind, id, range, anchorId, anchor: box }
}

/** Ask the shared card to show one entity under an element the caller rendered. False when the request is malformed. */
const request = (input: { readonly kind: string; readonly id: string; readonly range?: string | undefined }, element: Element): boolean => {
  const rect = element.getBoundingClientRect()
  const detail = decodeRequest({
    kind: input.kind,
    id: input.id,
    // decodeRequest treats an undefined range as absent.
    range: input.range,
    anchorId: anchorIdOf(element),
    anchor: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
  })
  if (detail === null) return false
  window.dispatchEvent(new CustomEvent(PREVIEW_EVENT, { detail }))
  return true
}

/** The shared reference-preview card's page protocol: providers request, input-trigger's overlay listens. */
export class EntityPreview {
  static readonly event = PREVIEW_EVENT
  /** The attribute the shared card marks its root with; link installers skip text inside it. */
  static readonly cardAttribute = 'data-dshfiles-entity-preview'
  static readonly anchorAttribute = ANCHOR_ATTRIBUTE
  static readonly anchorIdOf = anchorIdOf
  static readonly measure = measure
  static readonly decodeRequest = decodeRequest
  static readonly request = request
}

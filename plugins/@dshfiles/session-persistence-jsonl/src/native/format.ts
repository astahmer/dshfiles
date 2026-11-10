/**
 * On-disk format helpers for the JSONL session-persistence backend: path
 * sanitization (a {@link SessionId} is an unvalidated branded string, so it
 * MUST be encoded before use in a path — no traversal, no collision), the
 * per-project/session directory layout, header-line (de)serialization, and the
 * truncation-repair offset computation.
 *
 * @module dsh-session-persistence-jsonl/format
 */

import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import {
  SESSION_FORMAT_VERSION,
  KNOWN_SESSION_EVENT_TYPES,
  SessionLogOffset,
} from '@deepseek-ai/dsh-session'
import type {
  SessionEvent,
  SessionHeader,
  SessionId,
  SessionLogOffset as SessionLogOffsetType,
} from '@deepseek-ai/dsh-session'
import { parseSessionFormatLogFilename, sessionFormatLogFilename, SessionFormatUnsupportedMigrationError } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatRecovery, SessionFormatRestore } from '@deepseek-ai/dsh-session-format'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { assertV4RowAdmission, assertReleasedV4Relationships } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import {
  SessionFormatUnsupportedError,
  sessionFormatVersionRefusal,
  type SessionStorageMetadata,
} from '@deepseek-ai/dsh-session-persistence'

/** Physical encoding selected for JSONL session artifacts. */
export type JsonlCompression = 'zstd' | 'none'

/**
 * Header key marking a Session log whose repeated request-header tool catalogs
 * are references. A harness that predates this fork validates the header line
 * against a closed key set, so it refuses the artifact instead of reading a
 * reference as an empty tool list.
 */
export const TOOL_CATALOG_MARKER = 'dshfilesCatalogDedupe'

/** Single-key object written in place of a tool catalog this artifact already holds. */
export const TOOL_CATALOG_REFERENCE = '$dshfilesToolCatalog'

/** One assembled tool catalog's digest, computed from the row's own JSON encoding. */
const toolCatalogKey = (tools: readonly unknown[]): string =>
  createHash('sha256').update(JSON.stringify(tools)).digest('hex')

/**
 * Tool catalogs this artifact already holds. A full catalog is hashed only once
 * a later row names a digest, so a log without references never pays for it.
 */
export class ToolCatalogCatalogs {
  private readonly unindexed: (readonly unknown[])[] = []
  private readonly byDigest = new Map<string, readonly unknown[]>()

  /** Remember one full catalog, in file order. */
  hold(tools: readonly unknown[]): void {
    this.unindexed.push(tools)
  }

  /** The catalog an earlier row wrote with this digest, if any. */
  resolve(key: string): readonly unknown[] | undefined {
    for (const tools of this.unindexed.splice(0)) this.byDigest.set(toolCatalogKey(tools), tools)
    return this.byDigest.get(key)
  }
}

const isJsonObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The digest a row's `tools` slot references, or `undefined` when it holds a real catalog. */
const toolCatalogReference = (value: unknown): string | undefined => {
  if (!isJsonObject(value)) return undefined
  const keys = Object.keys(value)
  return keys.length === 1 && keys[0] === TOOL_CATALOG_REFERENCE && typeof value[TOOL_CATALOG_REFERENCE] === 'string'
    ? value[TOOL_CATALOG_REFERENCE] as string
    : undefined
}

/**
 * Mark one encoded header line as a log that may carry tool-catalog references.
 * @param line - the encoded `type: 'session'` line.
 * @returns the same line with the marker set.
 */
export function markToolCatalogHeaderLine<T extends Readonly<Record<string, unknown>>>(line: T): T {
  return { ...line, [TOOL_CATALOG_MARKER]: 1 } as unknown as T
}

/**
 * Drop the tool-catalog marker before the format catalog validates a header: the
 * released V4 header codec rejects keys it does not know.
 * @param value - a parsed header line.
 * @returns the same line without the marker.
 */
export function stripToolCatalogMarker(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  if (!Object.hasOwn(value, TOOL_CATALOG_MARKER)) return value
  const { [TOOL_CATALOG_MARKER]: _marker, ...rest } = value
  return rest
}

/**
 * Expand one parsed row: a full tool catalog is remembered for the rest of the
 * artifact, and a reference is replaced by the catalog written earlier.
 * @param row - one parsed JSONL event row.
 * @param catalogs - catalogs already seen in this artifact, in file order.
 * @returns the row a pre-fork reader would have written, or the row unchanged.
 */
export function rehydrateToolCatalog(row: unknown, catalogs: ToolCatalogCatalogs): unknown {
  if (!isJsonObject(row) || row['type'] !== 'request/header') return row
  const data = row['data']
  if (!isJsonObject(data)) return row
  const header = data['header']
  if (!isJsonObject(header)) return row
  const tools = header['tools']
  if (Array.isArray(tools)) {
    catalogs.hold(tools)
    return row
  }
  const key = toolCatalogReference(tools)
  if (key === undefined) return row
  const catalog = catalogs.resolve(key)
  if (catalog === undefined) {
    throw new Error(`tool catalog reference ${key} precedes the catalog it names`)
  }
  return { ...row, data: { ...data, header: { ...header, tools: catalog } } }
}

/**
 * Encodes an artifact's tool catalogs once: the first row carrying an assembled
 * catalog writes it in full, and every later row carrying the same catalog
 * writes a reference. A caller stages one durable batch, then commits once its
 * bytes are published; a failed append rolls back, so the in-memory state never
 * claims a catalog the artifact does not hold.
 */
export class ToolCatalogWriter {
  private readonly committed = new Set<string>()
  private staged: string[] | undefined

  /** Start staging one batch of rows. */
  begin(): void {
    this.staged = []
  }

  /** Keep the staged catalogs: their batch is durable. */
  commit(): void {
    for (const key of this.staged ?? []) this.committed.add(key)
    this.staged = undefined
  }

  /** Forget the staged catalogs: their batch was not published. */
  rollback(): void {
    this.staged = undefined
  }

  /**
   * Claim one catalog digest for the row about to be written.
   * @param key - digest of the row's own catalog encoding.
   * @returns `true` when this artifact already holds that catalog.
   */
  claim(key: string): boolean {
    if (this.committed.has(key) || this.staged?.includes(key) === true) return true
    this.staged?.push(key)
    return false
  }
}

/**
 * Rewrite one encoded row so a tool catalog this artifact already holds becomes
 * a reference.
 * @param row - the encoded physical row.
 * @param catalogs - the writer tracking this artifact's catalogs.
 * @returns the row with either the full catalog or a reference.
 */
const dedupeToolCatalogRow = (
  row: Readonly<Record<string, unknown>>,
  catalogs: ToolCatalogWriter,
): Readonly<Record<string, unknown>> => {
  if (row['type'] !== 'request/header') return row
  const data = row['data']
  if (!isJsonObject(data)) return row
  const header = data['header']
  if (!isJsonObject(header)) return row
  const tools = header['tools']
  if (!Array.isArray(tools)) return row
  const key = toolCatalogKey(tools)
  if (!catalogs.claim(key)) return row
  return { ...row, data: { ...data, header: { ...header, tools: { [TOOL_CATALOG_REFERENCE]: key } } } }
}

/**
 * Return the artifact suffix for one physical encoding.
 * @param compression - configured JSONL artifact encoding.
 * @returns `.jsonl.zstd` for Zstandard or `.jsonl` for plaintext.
 */
export function logSuffix(compression: JsonlCompression): '.jsonl.zstd' | '.jsonl' {
  return `.jsonl${compressionSuffix(compression)}`
}

function compressionSuffix(compression: JsonlCompression): '.zstd' | '' {
  return compression === 'zstd' ? '.zstd' : ''
}

/**
 * Return the canonical filename for one immutable Session format generation.
 * Version zero retains the original suffix-only name; every later generation
 * carries a lowercase numeric `vN` component.
 * @param version - non-negative safe Session format version.
 * @param compression - configured JSONL artifact encoding.
 * @returns the generation filename inside one Session directory.
 */
export function generationLogFilename(version: number, compression: JsonlCompression): string {
  return `${sessionFormatLogFilename(version)}${compressionSuffix(compression)}`
}

/**
 * Parse one canonical generation filename for the selected physical encoding.
 * Noncanonical, temporary, uppercase, leading-zero, and version-zero-tagged names do
 * not identify committed generations.
 * @param filename - one entry from a Session directory.
 * @param compression - configured JSONL artifact encoding.
 * @returns its format version, or `undefined` when the name is not canonical.
 */
export function parseGenerationLogFilename(
  filename: string,
  compression: JsonlCompression,
): number | undefined {
  const suffix = compressionSuffix(compression)
  if (!filename.endsWith(suffix)) return undefined
  return parseSessionFormatLogFilename(filename.slice(0, filename.length - suffix.length))
}

/**
 * The current physical header stored as the first JSONL record. The exact
 * inherited cut lives on the last tagged `session/end-seed` event.
 */
interface HeaderLine {
  type: 'session'
  version: number
  id: SessionId
  createdAt: number
  cwd?: string
  parentSession?: SessionId
  isSeeded: boolean
  origin?: 'subagent'
  delegationDepth: number
  agentPreset?: string
  dshfilesCatalogDedupe?: 1
}

const HEADER_REQUIRED_KEYS = ['type', 'version', 'id', 'createdAt', 'isSeeded', 'delegationDepth'] as const
const HEADER_OPTIONAL_KEYS = ['cwd', 'parentSession', 'origin', 'agentPreset', TOOL_CATALOG_MARKER] as const
const HEADER_KEYS = new Set<string>([...HEADER_REQUIRED_KEYS, ...HEADER_OPTIONAL_KEYS])

/**
 * Refuse policy fields that never belong to a released Session header.
 * @param value - parsed physical header candidate.
 * @returns nothing after successful validation.
 */
export function assertNoRetiredHeaderFields(value: unknown): void {
  if (typeof value !== 'object' || value === null) return
  if (Object.hasOwn(value, 'sandboxMode') || Object.hasOwn(value, 'approvalPolicy')) {
    throw new Error('session header uses retired policy baseline fields')
  }
}

/**
 * Build the header line object from a {@link SessionHeader}.
 * @param header - the immutable session metadata to serialize.
 * @param inheritedEventCount - exact inherited prefix length; required for a
 * seeded header and omitted only for an unseeded header.
 * @returns the `type: 'session'`-tagged line object, absent optional fields omitted (never null).
 */
export function toHeaderLine(
  header: SessionHeader,
  inheritedEventCount?: SessionLogOffsetType,
): HeaderLine {
  if (header.isSeeded && inheritedEventCount === undefined) {
    throw new Error('seeded session header requires an inherited event count')
  }
  const cut = SessionLogOffset(inheritedEventCount ?? 0)
  if (!header.isSeeded && cut !== 0) {
    throw new Error('unseeded session header inherited event count must be 0')
  }
  const encoded = sessionFormatCatalog.encodeCurrentHeader({
    ...header,
    delegationDepth: header.delegationDepth ?? 0,
  }, cut) as unknown as Readonly<Record<string, unknown>>
  return markToolCatalogHeaderLine(encoded) as unknown as HeaderLine
}

/**
 * Translate one current physical header into logical metadata and its cut.
 * @param line - the shape-checked first line of a log (see the `isHeaderLine` guard).
 * @returns logical Session metadata paired with the exact inherited prefix length.
 */
function fromHeaderLine(line: HeaderLine): SessionStorageMetadata {
  return {
    meta: {
      version: SESSION_FORMAT_VERSION,
      id: line.id,
      createdAt: line.createdAt,
      ...line.cwd !== undefined ? { cwd: line.cwd } : {},
      ...line.parentSession !== undefined ? { parentSession: line.parentSession } : {},
      isSeeded: line.isSeeded,
      ...line.origin !== undefined ? { origin: line.origin } : {},
      delegationDepth: line.delegationDepth,
      ...line.agentPreset !== undefined ? { agentPreset: line.agentPreset } : {},
    },
    inheritedEventCount: SessionLogOffset(0),
  }
}

/** Type guard: a parsed first line is a well-formed session header. */
function isHeaderLine(value: unknown): value is HeaderLine {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value)
    && HEADER_REQUIRED_KEYS.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => HEADER_KEYS.has(key))
    && (value as { type?: unknown }).type === 'session'
    && typeof (value as { version?: unknown }).version === 'number'
    && typeof (value as { id?: unknown }).id === 'string'
    && typeof (value as { createdAt?: unknown }).createdAt === 'number'
    && Number.isSafeInteger((value as { createdAt: number }).createdAt)
    && (value as { createdAt: number }).createdAt >= 0
    && !Object.is((value as { createdAt: number }).createdAt, -0)
    && typeof (value as { delegationDepth?: unknown }).delegationDepth === 'number'
    && Number.isSafeInteger((value as { delegationDepth: number }).delegationDepth)
    && (value as { delegationDepth: number }).delegationDepth >= 0
    && !Object.is((value as { delegationDepth: number }).delegationDepth, -0)
    && ((value as { cwd?: unknown }).cwd === undefined
      || (typeof (value as { cwd?: unknown }).cwd === 'string'
        && isAbsolute((value as { cwd: string }).cwd)))
    && ((value as { parentSession?: unknown }).parentSession === undefined
      || typeof (value as { parentSession?: unknown }).parentSession === 'string')
    && typeof (value as { isSeeded?: unknown }).isSeeded === 'boolean'
    && ((value as { origin?: unknown }).origin === undefined
      || (value as { origin?: unknown }).origin === 'subagent')
    && ((value as { agentPreset?: unknown }).agentPreset === undefined
      || typeof (value as { agentPreset?: unknown }).agentPreset === 'string')
    && ((value as { dshfilesCatalogDedupe?: unknown }).dshfilesCatalogDedupe === undefined
      || (value as { dshfilesCatalogDedupe?: unknown }).dshfilesCatalogDedupe === 1)
  )
}

/**
 * Encode an arbitrary string as a single safe path segment, injectively over ALL JS (UTF-16)
 * strings — including lone surrogates. A {@link SessionId} is an unvalidated branded string,
 * so this neutralizes `../`, absolute paths, NUL, and separators before any filesystem use.
 * Safe code units remain literal; every other unit, including `~`, becomes
 * `~XXXX`. Operating on code units preserves lone surrogates, while special-
 * casing `.` and `..` prevents traversal by an otherwise safe whole segment.
 *
 * @param raw - the string to encode; must be non-empty (throws on `''`).
 * @returns the escaped single path segment, decodable back to `raw`.
 */
export function encodeSegment(raw: string): string {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch
    } else {
      out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
    }
  }
  return out
}

/**
 * Build the readable directory key for a project path.
 * Filesystem separators and drive separators become `-`; unsafe code units use
 * the same `~XXXX` escape as session ids. The key is bounded for filesystem
 * component limits. Separator replacement and truncation are intentionally
 * lossy, following the common human-navigable project-directory convention.
 * @param cwd - the session's project directory.
 * @returns a single filesystem-safe project directory name.
 */
export function projectKey(cwd: string): string {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

/**
 * The configured root's human-navigable project directory. A configured root
 * may be local or shared; this grouping does not prescribe its deployment.
 * @param root - the backend's session root directory.
 * @param cwd - the session's project directory; `undefined` selects `_no-cwd`.
 * @returns the project directory path under `root`.
 */
export function projectDir(root: string, cwd: string | undefined): string {
  if (cwd === undefined) return join(root, '_no-cwd')
  return join(root, projectKey(cwd))
}

/**
 * The directory owned by one session and available for future session-local
 * artifacts.
 * @param root - the backend's session root directory.
 * @param cwd - the session's project directory.
 * @param id - the session id, encoded to one safe path segment.
 * @returns the session directory beneath its project directory.
 */
export function sessionDir(root: string, cwd: string | undefined, id: SessionId): string {
  return join(projectDir(root, cwd), encodeSegment(id))
}

/**
 * Build one immutable Session format generation path.
 * @param root - the backend's session root directory.
 * @param cwd - the session's project directory (`undefined` → `_no-cwd`).
 * @param id - the session id, path-encoded via {@link encodeSegment} before filesystem use.
 * @param version - physical Session format generation.
 * @param compression - physical artifact encoding and filename suffix.
 * @returns the selected generation's configured JSONL artifact path.
 */
export function generationLogPath(
  root: string,
  cwd: string | undefined,
  id: SessionId,
  version: number,
  compression: JsonlCompression,
): string {
  return join(sessionDir(root, cwd, id), generationLogFilename(version, compression))
}

/**
 * Build the current generation's append target path for a Session.
 * @param root - the backend's session root directory.
 * @param cwd - the session's project directory (`undefined` → `_no-cwd`).
 * @param id - the session id, path-encoded via {@link encodeSegment} before filesystem use.
 * @param compression - physical artifact encoding and filename suffix.
 * @returns the current Session format generation path.
 */
export function logPath(
  root: string,
  cwd: string | undefined,
  id: SessionId,
  compression: JsonlCompression,
): string {
  return generationLogPath(root, cwd, id, SESSION_FORMAT_VERSION, compression)
}

/**
 * Serialize a current event batch as JSONL lines (no trailing newline). Compact
 * Assistant streams are nested event data; every event occupies one row.
 * @param events - the batch to serialize, in log order.
 * @returns the batch's JSONL text; the writer adds the final newline.
 */
export function eventLines(events: readonly SessionEvent[], catalogs?: ToolCatalogWriter): string {
  return events.map(event => eventLine(event, catalogs)).join('\n')
}

/**
 * Serialize one current event as one JSONL record without its trailing newline.
 * @param event - current event to encode.
 * @returns one physical JSON record.
 */
export function eventLine(event: SessionEvent, catalogs?: ToolCatalogWriter): string {
  const encoded = sessionFormatCatalog.encodeCurrentEvent(event as unknown as SessionFormatEvent) as unknown as Readonly<Record<string, unknown>>
  return JSON.stringify(catalogs === undefined ? encoded : dedupeToolCatalogRow(encoded, catalogs))
}

interface SessionLogScan {
  meta: SessionHeader
  inheritedEventCount: SessionLogOffsetType
  events: SessionEvent[]
  committedBytes: number
}

/**
 * Refuse a header carrying a format version this build does not read BEFORE
 * validating the current header shape or decoding any event row: a future
 * format need not satisfy this build's structural checks at all, and its user
 * must see "upgrade the harness", never "corrupt session log".
 * @param parsed - the JSON-parsed first line of a session artifact.
 */
function refuseForeignFormatVersion(parsed: object): void {
  const { version, id } = parsed as { version?: unknown; id?: unknown }
  if (typeof version !== 'number' || version === SESSION_FORMAT_VERSION) return
  throw new SessionFormatUnsupportedError(
    sessionFormatVersionRefusal(typeof id === 'string' ? id : String(id), version),
  )
}

/** Parse one complete header record supplied independently from event rows. */
function parseHeaderRecord(record: Buffer): { readonly meta: SessionHeader; readonly restore: SessionFormatRestore } {
  if (record.length === 0 || record.at(-1) !== 0x0A || record.indexOf(0x0A) !== record.length - 1) {
    throw new Error('empty or header-less session log')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(record.subarray(0, -1).toString('utf8'))
  } catch {
    throw new Error('corrupt session log: header line is not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('corrupt session log: first line is not a JSON object')
  }
  refuseForeignFormatVersion(parsed)
  assertNoRetiredHeaderFields(parsed)
  if (!isHeaderLine(parsed)) {
    throw new Error('corrupt session log: first line is not a session header')
  }
  let restore: SessionFormatRestore
  try {
    restore = sessionFormatCatalog.createRestore(stripToolCatalogMarker(parsed as unknown as Readonly<Record<string, unknown>>), {
      recovery: 'strict',
      validation: 'transformed',
    })
  } catch {
    /* v8 ignore next -- isHeaderLine matches the current codec; this preserves classification if it tightens. */
    throw new Error('corrupt session log: first line is not a session header')
  }
  return { meta: fromHeaderLine(parsed).meta, restore }
}

/**
 * Incrementally scan complete JSONL event records after an independently
 * supplied header record. Newline search and byte offsets stay on raw buffers;
 * only complete records are decoded to UTF-8. A fragment crossing writes is
 * copied because a decoder may reuse its output buffer after `write()` returns.
 */
export class SessionLogScanner {
  private readonly meta: SessionHeader
  private readonly restore: SessionFormatRestore
  private eventCount = 0
  private fragments: Buffer[] = []
  private fragmentBytes = 0
  private inputBytes: number
  private committedBytes: number
  private eventLine = 0
  private issue: Error | undefined
  private finished = false
  private readonly toolCatalogs = new ToolCatalogCatalogs()

  /**
   * Create an event scanner from exactly one newline-terminated header record.
   * @param headerRecord - the complete first JSONL record, including its newline.
   */
  constructor(
    headerRecord: Buffer,
    private readonly recovery: SessionFormatRecovery = 'recoverable',
  ) {
    const parsed = parseHeaderRecord(headerRecord)
    this.meta = parsed.meta
    this.restore = parsed.restore
    this.inputBytes = headerRecord.length
    this.committedBytes = headerRecord.length
  }

  /**
   * Consume the next raw plaintext chunk, retaining only an incomplete final record.
   * @param chunk - bytes immediately following all previously supplied bytes.
   */
  write(chunk: Buffer): void {
    if (this.finished) throw new Error('cannot write to a finished session log scanner')
    const chunkStart = this.inputBytes
    this.inputBytes += chunk.length
    let lineStart = 0
    for (
      let newline = chunk.indexOf(0x0A);
      newline !== -1;
      newline = chunk.indexOf(0x0A, lineStart)
    ) {
      const fragment = chunk.subarray(lineStart, newline)
      let line = fragment
      if (this.fragments.length > 0) {
        if (fragment.length > 0) this.fragments.push(fragment)
        line = Buffer.concat(this.fragments, this.fragmentBytes + fragment.length)
        this.fragments = []
        this.fragmentBytes = 0
      }
      this.consumeEventLine(line, chunkStart + newline + 1)
      lineStart = newline + 1
    }
    if (lineStart < chunk.length) {
      const fragment = Buffer.from(chunk.subarray(lineStart))
      this.fragments.push(fragment)
      this.fragmentBytes += fragment.length
    }
  }

  /**
   * Snapshot progress before appending a recoverable torn-frame prefix.
   * @returns byte, committed-prefix, and expanded-event cursors.
   */
  checkpoint(): {
    inputBytes: number
    committedBytes: number
    eventCount: SessionLogOffsetType
  } {
    return {
      inputBytes: this.inputBytes,
      committedBytes: this.committedBytes,
      eventCount: SessionLogOffset(this.eventCount),
    }
  }

  /**
   * Finish scanning, ignoring a final record without a newline as a torn tail.
   * @returns the header, contiguous event prefix, and safe truncation offset.
   */
  finish(): SessionLogScan {
    this.finished = true
    const artifact = this.restore.finish()
    assertReleasedV4Relationships(artifact, KNOWN_SESSION_EVENT_TYPES)
    return {
      meta: this.meta,
      inheritedEventCount: SessionLogOffset(artifact.inheritedEventCount),
      events: artifact.events as unknown as SessionEvent[],
      committedBytes: this.committedBytes,
    }
  }

  /** Decode one complete event row and update the contiguous prefix. */
  private consumeEventLine(line: Buffer, endByte: number): void {
    this.eventLine += 1
    let decoded: unknown
    try {
      decoded = JSON.parse(line.toString('utf8')) as unknown
    } catch {
      const issue = new Error(`corrupt session log: unparsable committed event at line ${this.eventLine}`)
      if (this.recovery === 'strict') throw issue
      this.issue ??= issue
      return
    }

    try {
      decoded = rehydrateToolCatalog(decoded, this.toolCatalogs)
    } catch (error: unknown) {
      const issue = new Error(`corrupt session log: invalid tool catalog reference at line ${this.eventLine}`, {
        cause: error,
      })
      if (this.recovery === 'strict') throw issue
      this.issue ??= issue
      return
    }

    // This scanner accepts only current-generation files. Owned structural refusal must
    // precede its recoverable-tail suppression, independently of the strict decoder state.
    try {
      assertV4RowAdmission(decoded, KNOWN_SESSION_EVENT_TYPES)
    } catch (error: unknown) {
      if (error instanceof SessionFormatUnsupportedMigrationError) throw new SessionFormatUnsupportedError(error.message)
      throw error
    }

    if (this.issue !== undefined) {
      if (typeof decoded === 'object' && decoded !== null
        && (decoded as { type?: unknown }).type === 'turn/end') throw this.issue
      return
    }
    try {
      this.restore.decodeRow(decoded)
    } catch (error: unknown) {
      // Unsupported current-format rows have already been refused before recovery.
      /* v8 ignore next -- every production Session format decoder rejects with Error. */
      const detail = error instanceof Error ? error.message : String(error)
      const issue = new Error(`corrupt session log: invalid committed event at line ${this.eventLine}: ${detail}`, {
        cause: error,
      })
      if (this.recovery === 'strict') throw issue
      this.issue = issue
      if (typeof decoded === 'object' && decoded !== null
        && (decoded as { type?: unknown }).type === 'turn/end') throw issue
      return
    }
    this.eventCount += 1
    this.committedBytes = endByte
  }
}

/**
 * Parse a complete or torn JSONL buffer into its preserved event prefix. This
 * compatibility wrapper supplies the first record separately, then delegates
 * event rows to {@link SessionLogScanner}.
 *
 * @param buffer - the raw bytes of the log file (header line first).
 * @returns the header, preserved event prefix, and byte offset safe to append at.
 */
export function scanLog(buffer: Buffer): SessionLogScan {
  const headerEnd = buffer.indexOf(0x0A)
  if (headerEnd === -1) throw new Error('empty or header-less session log')
  const scanner = new SessionLogScanner(buffer.subarray(0, headerEnd + 1))
  scanner.write(buffer.subarray(headerEnd + 1))
  return scanner.finish()
}

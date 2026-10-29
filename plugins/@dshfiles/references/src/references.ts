import { defineDomain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { PluginApiError } from '@dshfiles/dshx/api'
import { commandAttributes, withSpan } from '@dshfiles/dshx/tracing'
import { execFile } from 'node:child_process'
import { mkdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'

const nameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,47}$/u, 'Use 1–48 lowercase letters, digits, dots, dashes or underscores, starting with a letter or digit.')

const referenceSchema = z
  .object({
    name: nameSchema,
    kind: z.enum(['directory', 'git']),
    /** The directory or the git URL the user gave. */
    source: z.string().min(1).max(2048),
    /** Branch or tag a git reference was cloned at; null for the remote's default branch or a directory. */
    ref: z.string().min(1).max(256).nullable(),
    /** Where the agent reads it: the directory itself, or the clone under `$DSH_HOME/references`. */
    path: z.string().min(1),
    description: z.string().max(500).nullable(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict()

const attachmentSchema = z.object({ sessionId: z.string().min(1).max(256), names: z.array(nameSchema).max(32) }).strict()

export type Reference = z.infer<typeof referenceSchema>
type Attachment = z.infer<typeof attachmentSchema>

const gitClone = (input: { readonly source: string; readonly ref: string | null; readonly path: string }): Promise<void> => {
  const args = ['clone', '--depth', '1', ...(input.ref === null ? [] : ['--branch', input.ref]), '--', input.source, input.path]
  const attributes = commandAttributes({ executable: 'git', args, valueFlags: ['--depth', '--branch'] })
  return withSpan(
    'git clone',
    { kind: 'client', attributes },
    span =>
      new Promise<void>((settle, fail) => {
        execFile('git', args, { timeout: 5 * 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, _stdout, stderr) => {
          span.setAttributes({ 'process.exit.code': error === null ? 0 : typeof error.code === 'number' ? error.code : 1 })
          if (error === null) return settle()
          span.setStatus('error', 'clone failed')
          fail(
            new PluginApiError(`git clone failed: ${stderr.trim().slice(0, 400) || error.message}. Check the URL, ref and your git credentials.`, {
              code: 'clone-failed',
            }),
          )
        })
      }),
  )
}

const GIT_SOURCE = /^(?:https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/|[\w.-]+@[\w.-]+:)/u

/** Named outside directories and git repositories, and which Sessions read them. */
export class References {
  static readonly nameSchema = nameSchema
  static readonly referenceSchema = referenceSchema

  static readonly domain = defineDomain({
    name: 'dshfiles_references',
    version: 1,
    layout: 'per-record',
    tables: {
      references: { valueSchema: referenceSchema, __key: 'references' },
      attachments: { valueSchema: attachmentSchema, __key: 'attachments' },
    },
  })

  /** A git URL (scheme or scp-like `user@host:path`) is cloned; an absolute or `~/` path is read where it is. */
  static kindOf(source: string): Reference['kind'] | undefined {
    if (GIT_SOURCE.test(source)) return 'git'
    if (isAbsolute(source) || source.startsWith('~/')) return 'directory'
    return undefined
  }

  /** Validates a source and readies it: a directory must exist; a git URL is shallow-cloned into `clonesDirectory/<name>`. */
  static async prepare(input: {
    readonly name: string
    readonly source: string
    readonly ref?: string | undefined
    readonly description?: string | undefined
    readonly clonesDirectory: string
  }): Promise<Reference> {
    const kind = References.kindOf(input.source)
    if (kind === undefined) {
      throw new PluginApiError('A reference is an absolute directory path (or ~/…) or a git URL (https://, ssh://, git@host:…, file://).', {
        code: 'invalid-source',
      })
    }
    if (kind === 'directory' && input.ref !== undefined) throw new PluginApiError('Only a git reference takes a ref.', { code: 'invalid-source' })
    const path =
      kind === 'git' ? join(input.clonesDirectory, input.name) : input.source.startsWith('~/') ? join(homedir(), input.source.slice(2)) : input.source
    if (kind === 'directory') {
      const found = await stat(path).catch(() => undefined)
      if (found?.isDirectory() !== true) throw new PluginApiError(`${path} is not a directory on this Host.`, { code: 'not-a-directory' })
    } else {
      await mkdir(input.clonesDirectory, { recursive: true })
      await rm(path, { recursive: true, force: true })
      await gitClone({ source: input.source, ref: input.ref ?? null, path })
    }
    return { name: input.name, kind, source: input.source, ref: input.ref ?? null, path, description: input.description ?? null, createdAt: Date.now() }
  }

  static promptText(references: readonly Reference[]): string {
    if (references.length === 0) return ''
    return [
      'Attached references: read-only material outside the working directory. Read them through their absolute paths when the task needs them; never edit them.',
      ...references.map(reference => {
        const origin = reference.kind === 'git' ? ` (clone of ${reference.source}${reference.ref === null ? '' : ` at ${reference.ref}`})` : ''
        return `- ${reference.name}: ${reference.path}${origin}${reference.description === null ? '' : ` — ${reference.description}`}`
      }),
    ].join('\n')
  }

  static store(tables: { readonly references: KvTable<string, Reference>; readonly attachments: KvTable<string, Attachment> }) {
    const list = (): Reference[] =>
      [...tables.references.entries()].map(([, reference]) => reference).sort((left, right) => left.name.localeCompare(right.name))
    const attachedNames = (sessionId: string): readonly string[] => tables.attachments.get(sessionId)?.names ?? []
    const attached = (sessionId: string): Reference[] =>
      attachedNames(sessionId)
        .map(name => tables.references.get(name))
        .filter(reference => reference !== undefined)
    const setNames = async (sessionId: string, names: readonly string[]): Promise<void> => {
      if (names.length === 0) await tables.attachments.delete(sessionId)
      else await tables.attachments.put(sessionId, { sessionId, names: [...names] })
    }
    return {
      list,
      get: (name: string): Reference | undefined => tables.references.get(name),
      attached,
      save: (reference: Reference): Promise<void> => tables.references.put(reference.name, reference),
      remove: async (name: string): Promise<boolean> => {
        const removed = await tables.references.delete(name)
        for (const [sessionId, attachment] of [...tables.attachments.entries()]) {
          if (attachment.names.includes(name))
            await setNames(
              sessionId,
              attachment.names.filter(candidate => candidate !== name),
            )
        }
        return removed
      },
      attach: async (sessionId: string, name: string): Promise<void> => {
        const names = attachedNames(sessionId)
        if (!names.includes(name)) await setNames(sessionId, [...names, name])
      },
      detach: async (sessionId: string, name: string): Promise<boolean> => {
        const names = attachedNames(sessionId)
        if (!names.includes(name)) return false
        await setNames(
          sessionId,
          names.filter(candidate => candidate !== name),
        )
        return true
      },
    }
  }
}

export type ReferenceStore = ReturnType<typeof References.store>

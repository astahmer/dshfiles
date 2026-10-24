import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-working-directory'
import { defineTool } from '@dshfiles/dshx/host'
import { z } from 'zod'
import { applyEdits, describeEditsFailure, type PatchEdit } from './apply-edits.js'

const editSchema = z
  .object({
    old: z.string(),
    new: z.string(),
    replaceAll: z.boolean().optional(),
  })
  .strict()

const inputSchema = z
  .object({
    path: z.string().trim().min(1).max(2048),
    edits: z.array(editSchema).min(1).max(50),
  })
  .strict()

const patchOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    exact: { type: 'integer', required: true },
    fuzzy: { type: 'integer', required: true },
    bytes: { type: 'integer', required: true },
    operation: { type: 'string', required: true },
  },
} as const

const describe = (output: {
  readonly path: string
  readonly exact: number
  readonly fuzzy: number
  readonly bytes: number
  readonly operation: string
}): string =>
  `${output.operation} ${output.path} · ${String(output.exact)} exact + ${String(output.fuzzy)} whitespace-tolerant edit(s) · ${String(output.bytes)} bytes`

/**
 * Edits one file without the native read-before-edit handshake: it reads the
 * file itself, keeps that read as an observation, and writes exactly once. The
 * measured failure classes it targets are "file has not been read" (613 in one
 * week), "file changed since it was read" (302) and "old_string was not found"
 * (269): a single atomic write after its own read removes the first two, and the
 * whitespace-tolerant retry removes most of the third.
 *
 * Built from the plugin's own context, never from the scoped Agent one: a scoped
 * Agent context only resolves services it declares as injected, so reading the
 * filesystem services there throws `cannot get property … without inject` (453
 * failures in one week). `apply-patch` declares those services itself, and the
 * tool body must read them from the context that declared them.
 */
export const createApplyPatchTool = (ctx: Context) =>
  defineTool({
    name: 'apply_patch',
    description:
      'Edit one existing text file atomically: reads it first, applies literal replacements in order, then writes once. Whitespace-tolerant fallback finds a reindented or rewrapped anchor; an ambiguous or missing anchor fails without writing and names the candidate lines. Use it after inspecting a file with ast-outline, bash or grep instead of `edit`. Read-only when it fails; it never creates a file.',
    parameters: {
      path: { type: 'string', required: true, description: 'File to edit; relative paths resolve against the Session working directory.' },
      edits: {
        type: 'array',
        required: true,
        description: 'Ordered replacements; each anchor must match once unless replaceAll is set.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            old: { type: 'string', required: true, description: 'Literal text to find.' },
            new: { type: 'string', required: true, description: 'Replacement text.' },
            replaceAll: { type: 'boolean', description: 'Replace every match instead of requiring exactly one.' },
          },
        },
      },
    },
    output: {
      schema: patchOutputSchema,
      render(_args, value) {
        return [{ type: 'text', text: describe(value) }]
      },
    },
    execute: async (args, execution) => {
      const input = inputSchema.parse(args)
      const agent = execution.agent
      const cwd = agent === undefined ? undefined : await ctx.workingDirectory.ensure(agent, execution.signal)
      const resolveOptions: { readonly cwd?: string; readonly signal: AbortSignal } =
        cwd === undefined ? { signal: execution.signal } : { cwd, signal: execution.signal }
      const target = await ctx.fs.resolve(input.path, resolveOptions)
      const info = await ctx.fs.stat(target, execution.signal)
      if (info === undefined) {
        ctx.emit('fs/observed', target, { kind: 'absent' }, execution)
        throw new Error(`cannot patch "${target.displayPath}": not found`)
      }
      if (info.type !== 'file') throw new Error(`cannot patch "${target.displayPath}": not a regular file`)
      const before = await ctx.fs.readText(target, execution.signal)
      ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, execution)
      const edits: readonly PatchEdit[] = input.edits.map(edit =>
        edit.replaceAll === undefined ? { old: edit.old, new: edit.new } : { old: edit.old, new: edit.new, replaceAll: edit.replaceAll },
      )
      const result = applyEdits({ content: before, edits })
      if (!result.ok) throw new Error(`cannot patch "${target.displayPath}": ${describeEditsFailure(result.error)}`)
      const outcome = await ctx.fs.writeText(target, result.value.content, undefined, execution.signal)
      ctx.emit('fs/observed', target, { kind: 'present', version: outcome.version }, execution)
      return {
        path: ctx.fs.processPath(target),
        exact: result.value.exact,
        fuzzy: result.value.fuzzy,
        bytes: Buffer.byteLength(result.value.content, 'utf8'),
        operation: outcome.operation,
      }
    },
  })

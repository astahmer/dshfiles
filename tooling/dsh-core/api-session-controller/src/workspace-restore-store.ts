import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const commitIdSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)

const workspaceRestoreJournalSchema = z.object({
  operationId: z.string().uuid(),
  action: z.enum(['restore', 'retry', 'rollback']),
  sessionId: z.string().min(1),
  workspaceId: z.string().min(1),
  workspacePath: z.string().min(1),
  directoryIdentity: z.string().min(1),
  savedCommitId: commitIdSchema,
  targetCommitId: commitIdSchema,
  attemptBeforeCommitId: commitIdSchema,
  attemptTargetCommitId: commitIdSchema,
  state: z.enum(['applying', 'complete', 'unchanged', 'partial', 'rollback-applying', 'rolled-back', 'uncertain']),
  failure: z.enum(['cancelled', 'command-failed', 'timeout', 'process-not-quiescent', 'workspace-changed', 'verification-failed']).optional(),
  currentCommitId: commitIdSchema.optional(),
  updatedAt: z.number().int().nonnegative(),
})

export type WorkspaceRestoreJournal = z.infer<typeof workspaceRestoreJournalSchema>

export const workspaceRestoreDomainSpec = defineDomain({
  name: 'dsh_api_session_workspace_restore',
  version: 1,
  layout: 'single',
  tables: {
    workspaces: domainTable(workspaceRestoreJournalSchema),
  },
})

export class WorkspaceRestoreStore {
  private domain: Domain<typeof workspaceRestoreDomainSpec> | undefined
  private writeTail: Promise<void> = Promise.resolve()

  async open(storageDomain: Context['storageDomain']): Promise<void> {
    if (this.domain !== undefined) return
    this.domain = await storageDomain.open(workspaceRestoreDomainSpec)
  }

  get(workspaceId: string): WorkspaceRestoreJournal | undefined {
    return this.domain?.table('workspaces').get(workspaceId)
  }

  list(): readonly WorkspaceRestoreJournal[] {
    return [...(this.domain?.table('workspaces').entries() ?? [])].map(([, journal]) => journal)
  }

  put(receipt: WorkspaceRestoreJournal): Promise<void> {
    const domain = this.domain
    if (domain === undefined) return Promise.reject(new Error('Workspace restore store is not open'))
    const result = this.writeTail.then(() => domain.table('workspaces').put(receipt.workspaceId, receipt))
    this.writeTail = result.then(() => undefined, () => undefined)
    return result
  }

  async flush(): Promise<void> {
    await this.writeTail
  }

  async close(): Promise<void> {
    const domain = this.domain
    if (domain === undefined) return
    await this.flush()
    await domain.close()
    if (this.domain === domain) this.domain = undefined
  }
}

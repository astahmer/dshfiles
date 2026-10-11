export const JUJUTSU_QUERY_STALE_TIME = 60_000
export const JUJUTSU_QUERY_GC_TIME = 120_000

export const jujutsuQueryKeys = {
  repository: (root: string) => ['jujutsu', root] as const,
  state: (root: string, limit: number) => ['jujutsu', root, 'state', limit] as const,
  details: (root: string, commitId: string) => ['jujutsu', root, 'details', commitId] as const,
  revisionFiles: (root: string, commitIds: readonly string[]) => ['jujutsu', root, 'revision-files', commitIds.join(',')] as const,
}

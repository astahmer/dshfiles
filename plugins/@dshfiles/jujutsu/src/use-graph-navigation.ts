import { useApi } from '@dshfiles/dshx/client'
import { errorMessage, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { jujutsuApi, type GraphLandmark, type Revision, type RevisionRelationship } from './api.js'
import { GraphNavigationModel, type GraphViewFilter, type HiddenGraphHistory } from './graph-navigation.js'
import { resolveGraphSelection } from './graph-selection.js'
import { JUJUTSU_QUERY_GC_TIME, JUJUTSU_QUERY_STALE_TIME } from './repository-query-cache.js'

type ComparisonTarget = GraphLandmark['kind'] | 'revision'

interface GraphNavigationInput {
  readonly repoId: string | null
  readonly root: string
  readonly refreshedAt: number
  readonly selected: Pick<Revision, 'commitId' | 'changeId'> | undefined
  readonly comparison: Pick<Revision, 'commitId' | 'changeId'> | undefined
  readonly revisions: readonly Revision[]
}

const readResult = <Output extends object>(result: Output | { failure: { message: string } }): Output => {
  if ('failure' in result) throw new Error(result.failure.message)
  return result
}

export const useGraphNavigation = (input: GraphNavigationInput) => {
  const api = useApi(jujutsuApi)
  const scope = `${input.root}:${input.repoId ?? ''}`
  const activeScope = useRef(scope)
  activeScope.current = scope
  const generation = useRef(0)
  const [targetKey, setTargetKey] = useState<ComparisonTarget>('main')
  const [comparisonOpen, setComparisonOpen] = useState(false)
  const [customTargetId, setCustomTargetId] = useState('')
  const [view, setView] = useState<GraphViewFilter | null>(null)
  const [hidden, setHidden] = useState<readonly HiddenGraphHistory[]>([])
  const [revealed, setRevealed] = useState<readonly Revision[]>([])
  const [lens, setLens] = useState<RevisionRelationship | null>(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    generation.current += 1
    setView(null)
    setHidden([])
    setRevealed([])
    setLens(null)
    setNotice('')
    setTargetKey('main')
    setCustomTargetId('')
    setComparisonOpen(false)
  }, [scope])

  const landmarksQuery = useQuery({
    queryKey: ['jujutsu', input.root, 'graph-navigation', input.repoId, input.refreshedAt],
    queryFn: async ({ signal }) => readResult(await api.graphNavigation({ repoId: input.repoId ?? '' }, { signal })),
    enabled: input.repoId !== null,
    retry: false,
    staleTime: JUJUTSU_QUERY_STALE_TIME,
    gcTime: JUJUTSU_QUERY_GC_TIME,
    refetchOnWindowFocus: false,
  })
  const extraRevisions = useMemo(() => GraphNavigationModel.mergeGraphRevisions(view?.revisions ?? [], revealed), [view, revealed])
  const selectedRevision = resolveGraphSelection({ selection: input.selected, revisions: input.revisions, extraRevisions })
  const comparisonRevision = resolveGraphSelection({ selection: input.comparison, revisions: input.revisions, extraRevisions })
  const landmarks = landmarksQuery.data?.landmarks ?? []
  const targetLandmark = landmarks.find(landmark => landmark.kind === targetKey)
  const targetRevision = targetKey === 'revision' ? undefined : targetLandmark?.status === 'resolved' ? targetLandmark.revisions[0] : undefined
  const targetCommitId = targetKey === 'revision' ? customTargetId : (targetRevision?.commitId ?? '')
  const targetLabel = targetKey === 'revision' ? customTargetId.slice(0, 12) : (targetLandmark?.label ?? targetKey)
  const comparisonTarget = landmarks.find(landmark => landmark.kind === targetKey)
  const preferredTarget =
    landmarks.find(landmark => landmark.kind === 'main' && landmark.status === 'resolved') ??
    landmarks.find(landmark => landmark.kind === 'main-origin' && landmark.status === 'resolved') ??
    landmarks.find(landmark => landmark.kind === 'default' && landmark.status === 'resolved')
  const defaultTargetKey: ComparisonTarget = preferredTarget?.kind ?? 'main'
  const beginComparison = (target?: ComparisonTarget): void => {
    const nextTarget = target ?? defaultTargetKey
    setTargetKey(nextTarget)
    if (nextTarget === 'revision') setCustomTargetId('')
    setComparisonOpen(true)
  }

  const chooseTarget = (value: string): void => {
    if (value !== 'current' && value !== 'main-origin' && value !== 'main' && value !== 'default' && value !== 'revision') return
    setTargetKey(value)
    if (value === 'revision') setCustomTargetId('')
  }

  const closeComparison = (): void => setComparisonOpen(false)

  const relationshipQuery = useQuery({
    queryKey: ['jujutsu', input.root, 'relationship', input.repoId, comparisonRevision?.commitId, targetCommitId, input.refreshedAt],
    queryFn: async ({ signal }) =>
      readResult(
        await api.revisionRelationship(
          {
            repoId: input.repoId ?? '',
            commitId: comparisonRevision?.commitId ?? '',
            targetCommitId,
          },
          { signal },
        ),
      ),
    enabled: comparisonOpen && input.repoId !== null && comparisonRevision !== undefined && targetCommitId.length > 0,
    retry: false,
    staleTime: JUJUTSU_QUERY_STALE_TIME,
    gcTime: JUJUTSU_QUERY_GC_TIME,
    refetchOnWindowFocus: false,
  })

  const sliceMutation = useMutation({
    mutationFn: async (request: {
      readonly revision: Revision
      readonly mode: 'history' | 'exclusive'
      readonly scope: string
      readonly generation: number
    }) => ({
      request,
      result: readResult(await api.graphSlice({ repoId: input.repoId ?? '', commitId: request.revision.commitId, mode: request.mode })),
    }),
    onSuccess: ({ request, result }) => {
      if (request.scope !== activeScope.current || request.generation !== generation.current) return
      const label = request.revision.shortestChangeId
      if (request.mode === 'history') {
        setView({
          kind: 'history',
          label: `History leading to ${label}`,
          commitIds: new Set(result.revisions.map(row => row.commitId)),
          revisions: result.revisions,
          truncated: result.truncated,
        })
        setLens(null)
        setRevealed([])
        setNotice('')
        return
      }
      if (result.revisions.length === 0) {
        setNotice('Nothing exclusive to hide: this history is shared with retained descendants, bookmarks, or workspaces.')
        return
      }
      setHidden(current => [
        ...current.filter(item => item.commitId !== request.revision.commitId),
        {
          commitId: request.revision.commitId,
          label,
          commitIds: result.revisions.map(row => row.commitId),
          truncated: result.truncated,
        },
      ])
      setRevealed([])
      setNotice(`Hidden exclusive history leading to ${label}. Shared history remains visible.`)
    },
    onError: (error, request) => {
      if (request.scope === activeScope.current && request.generation === generation.current) setNotice(errorMessage(error, 'Graph view could not be loaded.'))
    },
  })

  const applySlice = (revision: Revision, mode: 'history' | 'exclusive'): void => {
    generation.current += 1
    sliceMutation.mutate({ revision, mode, scope, generation: generation.current })
  }

  const applyRelationship = (kind: 'difference' | 'connection'): void => {
    const relationship = relationshipQuery.data
    if (relationship === undefined) return
    generation.current += 1
    const ids = kind === 'difference' ? relationship.differenceIds : relationship.connectionIds
    setView({
      kind,
      label: kind === 'difference' ? `Selected-only relative to ${targetLabel}` : `Connection to ${targetLabel}`,
      commitIds: new Set(kind === 'difference' ? ids : [...ids, relationship.commitId, relationship.targetCommitId, ...relationship.commonAncestorIds]),
      revisions: relationship.revisions,
      truncated: relationship.truncated,
    })
    setLens(null)
    setRevealed([])
    setNotice('')
  }

  const showConnection = (): void => {
    const relationship = relationshipQuery.data
    if (relationship === undefined) return
    generation.current += 1
    setLens(relationship)
    setNotice('Connection highlighted; unrelated revision text dimmed. Graph rails remain unchanged.')
  }

  const reset = (): void => {
    generation.current += 1
    setView(null)
    setHidden([])
    setRevealed([])
    setLens(null)
    setNotice('')
    sliceMutation.reset()
  }

  return {
    selectedRevision,
    comparisonRevision,
    comparisonOpen,
    comparisonTarget,
    defaultTargetKey,
    landmarks,
    landmarksQuery,
    targetKey,
    chooseTarget,
    beginComparison,
    closeComparison,
    customTargetId,
    setCustomTargetId,
    targetLabel,
    targetCommitId,
    relationshipQuery,
    view,
    hidden,
    revealed,
    lens,
    notice,
    setNotice,
    sliceMutation,
    applySlice,
    applyRelationship,
    showConnection,
    reset,
    clearView: () => {
      generation.current += 1
      setView(null)
    },
    clearLens: () => setLens(null),
    removeHidden: (commitId: string) => setHidden(current => current.filter(item => item.commitId !== commitId)),
    clearRevealed: () => setRevealed([]),
    reveal: (revision: Revision) => setRevealed(current => GraphNavigationModel.mergeGraphRevisions(current, [revision])),
    extraRevisions,
  }
}

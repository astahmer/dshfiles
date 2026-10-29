import { useApi } from '@dshfiles/dshx/client'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo, useState } from 'react'
import { jujutsuApi, type GraphLandmark, type Revision } from './api.js'
import { GraphNavigationModel } from './graph-navigation.js'
import { resolveGraphSelection } from './graph-selection.js'
import {
  graphNavigationMachine,
  selectGraphNavigationViewState,
  type GraphNavigationClient,
  type GraphSliceMode,
  type GraphSliceRequest,
} from './graph-navigation-machine.js'
import { JUJUTSU_QUERY_GC_TIME, JUJUTSU_QUERY_STALE_TIME } from './repository-query-cache.js'

type ComparisonTarget = GraphLandmark['kind'] | 'revision'

interface GraphNavigationInput {
  readonly repoId: string | null
  readonly root: string
  readonly refreshedAt: number
  readonly onScreen: boolean
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
  const sliceClient = useMemo<GraphNavigationClient>(
    () => ({ graphSlice: async (request: GraphSliceRequest, options) => readResult(await api.graphSlice(request, options)) }),
    [api],
  )
  const [navigationSnapshot, sendNavigation] = useMachine(graphNavigationMachine, {
    input: { client: sliceClient, scope, repoId: input.repoId },
  })
  const [targetKey, setTargetKey] = useState<ComparisonTarget>('main')
  const [comparisonOpen, setComparisonOpen] = useState(false)
  const [customTargetId, setCustomTargetId] = useState('')

  useEffect(() => {
    sendNavigation({ type: 'scope.change', scope, repoId: input.repoId })
    setTargetKey('main')
    setCustomTargetId('')
    setComparisonOpen(false)
  }, [scope, input.repoId, sendNavigation])
  const navigation = navigationSnapshot.context
  const scopeReady = navigation.scope === scope
  const navigationView = selectGraphNavigationViewState(navigation, scope)
  const scopedTargetKey = scopeReady ? targetKey : 'main'
  const scopedComparisonOpen = scopeReady && comparisonOpen
  const scopedCustomTargetId = scopeReady ? customTargetId : ''

  const landmarksQuery = useQuery({
    queryKey: ['jujutsu', input.root, 'graph-navigation', input.repoId, input.refreshedAt],
    queryFn: async ({ signal }) => readResult(await api.graphNavigation({ repoId: input.repoId ?? '' }, { signal })),
    enabled: input.repoId !== null && input.onScreen,
    retry: false,
    staleTime: JUJUTSU_QUERY_STALE_TIME,
    gcTime: JUJUTSU_QUERY_GC_TIME,
    refetchOnWindowFocus: false,
  })
  const extraRevisions = useMemo(
    () => GraphNavigationModel.mergeGraphRevisions(navigationView.view?.revisions ?? [], navigationView.revealed),
    [navigationView.view, navigationView.revealed],
  )
  const selectedRevision = resolveGraphSelection({ selection: input.selected, revisions: input.revisions, extraRevisions })
  const comparisonRevision = resolveGraphSelection({ selection: input.comparison, revisions: input.revisions, extraRevisions })
  const landmarks = landmarksQuery.data?.landmarks ?? []
  const targetLandmark = landmarks.find(landmark => landmark.kind === scopedTargetKey)
  const targetRevision = scopedTargetKey === 'revision' ? undefined : targetLandmark?.status === 'resolved' ? targetLandmark.revisions[0] : undefined
  const targetCommitId = scopedTargetKey === 'revision' ? scopedCustomTargetId : (targetRevision?.commitId ?? '')
  const targetLabel = scopedTargetKey === 'revision' ? scopedCustomTargetId.slice(0, 12) : (targetLandmark?.label ?? scopedTargetKey)
  const comparisonTarget = landmarks.find(landmark => landmark.kind === scopedTargetKey)
  const preferredTarget =
    landmarks.find(landmark => landmark.kind === 'main' && landmark.status === 'resolved') ??
    landmarks.find(landmark => landmark.kind === 'main-origin' && landmark.status === 'resolved') ??
    landmarks.find(landmark => landmark.kind === 'default' && landmark.status === 'resolved')
  const defaultTargetKey: ComparisonTarget = preferredTarget?.kind ?? 'main'
  const beginComparison = (target?: ComparisonTarget): void => {
    if (!scopeReady) return
    const nextTarget = target ?? defaultTargetKey
    setTargetKey(nextTarget)
    if (nextTarget === 'revision') setCustomTargetId('')
    setComparisonOpen(true)
  }

  const chooseTarget = (value: string): void => {
    if (!scopeReady || (value !== 'current' && value !== 'main-origin' && value !== 'main' && value !== 'default' && value !== 'revision')) return
    setTargetKey(value)
    if (value === 'revision') setCustomTargetId('')
  }

  const closeComparison = (): void => {
    if (scopeReady) setComparisonOpen(false)
  }

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
    enabled: scopedComparisonOpen && input.repoId !== null && comparisonRevision !== undefined && targetCommitId.length > 0,
    retry: false,
    staleTime: JUJUTSU_QUERY_STALE_TIME,
    gcTime: JUJUTSU_QUERY_GC_TIME,
    refetchOnWindowFocus: false,
  })

  const relationship = scopeReady ? relationshipQuery.data : undefined
  const lensSelection = navigationView.lensSelection
  const lens =
    lensSelection !== null &&
    relationship !== undefined &&
    relationship.commitId === lensSelection.commitId &&
    relationship.targetCommitId === lensSelection.targetCommitId
      ? relationship
      : null

  const applySlice = (revision: Revision, mode: GraphSliceMode): void => {
    if (scopeReady) sendNavigation({ type: 'slice.apply', revision, mode })
  }

  const applyRelationship = (kind: 'difference' | 'connection'): void => {
    if (!scopeReady || relationship === undefined) return
    sendNavigation({ type: 'relationship.apply', kind, relationship, targetLabel })
  }

  const showConnection = (): void => {
    if (!scopeReady || relationship === undefined) return
    sendNavigation({ type: 'relationship.highlight', commitId: relationship.commitId, targetCommitId: relationship.targetCommitId })
  }

  const reset = (): void => {
    if (scopeReady) sendNavigation({ type: 'reset' })
  }

  return {
    selectedRevision,
    comparisonRevision,
    comparisonOpen: scopedComparisonOpen,
    comparisonTarget,
    defaultTargetKey,
    landmarks,
    landmarksQuery,
    targetKey: scopedTargetKey,
    chooseTarget,
    beginComparison,
    closeComparison,
    customTargetId: scopedCustomTargetId,
    setCustomTargetId: (value: string) => {
      if (scopeReady) setCustomTargetId(value)
    },
    targetLabel,
    targetCommitId,
    relationshipQuery,
    view: navigationView.view,
    hidden: navigationView.hidden,
    revealed: navigationView.revealed,
    lens,
    notice: navigationView.notice,
    slicePending: scopeReady && navigationSnapshot.matches('loading'),
    clearNotice: () => {
      if (scopeReady) sendNavigation({ type: 'notice.clear' })
    },
    applySlice,
    applyRelationship,
    showConnection,
    reset,
    clearView: () => {
      if (scopeReady) sendNavigation({ type: 'view.clear' })
    },
    clearLens: () => {
      if (scopeReady) sendNavigation({ type: 'lens.clear' })
    },
    removeHidden: (commitId: string) => {
      if (scopeReady) sendNavigation({ type: 'hidden.remove', commitId })
    },
    clearRevealed: () => {
      if (scopeReady) sendNavigation({ type: 'revealed.clear' })
    },
    reveal: (revision: Revision) => {
      if (scopeReady) sendNavigation({ type: 'revision.reveal', revision })
    },
    extraRevisions,
  }
}

import { useApi } from '@dshfiles/dshx/client'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useMemo } from 'react'
import { jujutsuApi, type Revision } from './api.js'
import { GraphLandmarksQuery } from './graph-landmarks-query.js'
import { GraphNavigationModel } from './graph-navigation.js'
import { resolveGraphSelection } from './graph-selection.js'
import {
  graphNavigationMachine,
  isComparisonTarget,
  selectGraphNavigationViewState,
  type ComparisonTarget,
  type GraphNavigationClient,
  type GraphSliceMode,
  type GraphSliceRequest,
} from './graph-navigation-machine.js'
import { ProjectBookmarkRequest } from './project-bookmark-request.js'
import { JUJUTSU_QUERY_GC_TIME, JUJUTSU_QUERY_STALE_TIME } from './repository-query-cache.js'

interface GraphNavigationInput {
  readonly repoId: string | null
  readonly root: string
  readonly refreshedAt: number
  readonly onScreen: boolean
  /** The project's main branch (Settings › Projects), named by the main landmarks. */
  readonly bookmark: string
  readonly selected: Pick<Revision, 'commitId' | 'changeId'> | undefined
  readonly comparison: Pick<Revision, 'commitId' | 'changeId'> | undefined
  readonly revisions: readonly Revision[]
}

export const useGraphNavigation = (input: GraphNavigationInput) => {
  const api = useApi(jujutsuApi)
  const scope = `${input.root}:${input.repoId ?? ''}`
  const sliceClient = useMemo<GraphNavigationClient>(
    () => ({
      graphSlice: async (request: GraphSliceRequest, options) => {
        const result = await api.graphSlice(request, options)
        if ('failure' in result) throw new Error(result.failure.message)
        return result
      },
    }),
    [api],
  )
  const [navigationSnapshot, sendNavigation] = useMachine(graphNavigationMachine, {
    input: { client: sliceClient, scope, repoId: input.repoId },
  })

  useEffect(() => {
    sendNavigation({ type: 'scope.change', scope, repoId: input.repoId })
  }, [scope, input.repoId, sendNavigation])
  const navigation = navigationSnapshot.context
  const scopeReady = navigation.scope === scope
  const navigationView = selectGraphNavigationViewState(navigation, scope)
  const comparison = navigationView.comparison

  const landmarksQuery = useQuery(
    GraphLandmarksQuery.options({
      root: input.root,
      repoId: input.repoId,
      refreshedAt: input.refreshedAt,
      onScreen: input.onScreen,
      bookmark: input.bookmark,
      read: async (repoId, signal) => {
        const result = await ProjectBookmarkRequest.withProjectBookmark({
          bookmark: input.bookmark,
          read: bookmark => api.graphNavigation(bookmark === undefined ? { repoId } : { repoId, bookmark }, { signal }),
        })
        if ('failure' in result) throw new Error(result.failure.message)
        return result
      },
    }),
  )
  const extraRevisions = useMemo(
    () => GraphNavigationModel.mergeGraphRevisions(navigationView.view?.revisions ?? [], navigationView.revealed),
    [navigationView.view, navigationView.revealed],
  )
  const selectedRevision = resolveGraphSelection({ selection: input.selected, revisions: input.revisions, extraRevisions })
  const comparisonRevision = resolveGraphSelection({ selection: input.comparison, revisions: input.revisions, extraRevisions })
  const landmarks = landmarksQuery.data?.landmarks ?? []
  const targetLandmark = landmarks.find(landmark => landmark.kind === comparison.target)
  const targetRevision = comparison.target === 'revision' ? undefined : targetLandmark?.status === 'resolved' ? targetLandmark.revisions[0] : undefined
  const targetCommitId = comparison.target === 'revision' ? comparison.customTargetId : (targetRevision?.commitId ?? '')
  const targetLabel = comparison.target === 'revision' ? comparison.customTargetId.slice(0, 12) : (targetLandmark?.label ?? comparison.target)
  const comparisonTarget = landmarks.find(landmark => landmark.kind === comparison.target)
  const preferredTarget =
    landmarks.find(landmark => landmark.kind === 'main' && landmark.status === 'resolved') ??
    landmarks.find(landmark => landmark.kind === 'main-origin' && landmark.status === 'resolved') ??
    landmarks.find(landmark => landmark.kind === 'default' && landmark.status === 'resolved')
  const defaultTargetKey: ComparisonTarget = preferredTarget?.kind ?? 'main'
  const beginComparison = (target?: ComparisonTarget): void => {
    if (!scopeReady) return
    sendNavigation({ type: 'comparison.open', target: target ?? defaultTargetKey })
  }

  const chooseTarget = (value: string): void => {
    if (!scopeReady || !isComparisonTarget(value)) return
    sendNavigation({ type: 'comparison.target', target: value })
  }

  const closeComparison = (): void => {
    if (scopeReady) sendNavigation({ type: 'comparison.close' })
  }

  const relationshipQuery = useQuery({
    queryKey: ['jujutsu', input.root, 'relationship', input.repoId, comparisonRevision?.commitId, targetCommitId, input.refreshedAt],
    queryFn: async ({ signal }) => {
      const result = await api.revisionRelationship(
        {
          repoId: input.repoId ?? '',
          commitId: comparisonRevision?.commitId ?? '',
          targetCommitId,
        },
        { signal },
      )
      if ('failure' in result) throw new Error(result.failure.message)
      return result
    },
    enabled: comparison.open && input.repoId !== null && comparisonRevision !== undefined && targetCommitId.length > 0,
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
    comparisonOpen: comparison.open,
    comparisonTarget,
    defaultTargetKey,
    landmarks,
    landmarksQuery,
    targetKey: comparison.target,
    chooseTarget,
    beginComparison,
    closeComparison,
    customTargetId: comparison.customTargetId,
    setCustomTargetId: (value: string) => {
      if (scopeReady) sendNavigation({ type: 'comparison.custom', value })
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

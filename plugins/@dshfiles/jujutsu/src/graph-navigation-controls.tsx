import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { LocateFixedIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { errorMessage } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import type { Revision } from './api.js'
import { matchesRevisionSearch } from './graph.js'
import { GraphNavigationModel } from './graph-navigation.js'
import type { useGraphNavigation } from './use-graph-navigation.js'

type Navigation = ReturnType<typeof useGraphNavigation>

interface LandmarkControlsProps {
  readonly navigation: Navigation
  readonly onLocate: (revision: Revision) => void
}

export const LandmarkControls = ({ navigation, onLocate }: LandmarkControlsProps): JSX.Element => (
  <div aria-label="Graph landmarks" className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-1">
    <LocateFixedIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
    {navigation.landmarks.length === 0 && (
      <span className="dshx:text-xs dshx:text-muted-foreground">{navigation.landmarksQuery.isFetching ? 'Loading landmarks…' : 'Landmarks unavailable'}</span>
    )}
    {navigation.landmarks.map(landmark => {
      const revision = landmark.status === 'resolved' ? landmark.revisions[0] : undefined
      return (
        <Button
          aria-label={`Locate ${landmark.label}`}
          disabled={revision === undefined}
          key={landmark.kind}
          onClick={() => {
            if (revision !== undefined) onLocate(revision)
          }}
          size="xs"
          title={revision === undefined ? `${landmark.label}: ${landmark.status}` : `${landmark.label} · ${revision.shortestChangeId} · ${revision.commitId}`}
          type="button"
          variant="ghost"
        >
          {landmark.label}
        </Button>
      )
    })}
    {navigation.landmarksQuery.error !== null && (
      <span className="dshx:text-xs dshx:text-destructive" role="status">
        {errorMessage(navigation.landmarksQuery.error, 'Landmark reads require the updated Host.')}
      </span>
    )}
  </div>
)

interface RelationshipInspectorProps {
  readonly navigation: Navigation
  readonly selected: Revision
  readonly revisions: readonly Revision[]
  readonly onLocate: (revision: Revision) => void
}

const SELECT_CLASS = 'dshx:h-7 dshx:min-w-0 dshx:max-w-full dshx:rounded-md dshx:border dshx:bg-background dshx:px-2 dshx:text-xs'

export const RelationshipInspector = ({ navigation, selected, revisions, onLocate }: RelationshipInspectorProps): JSX.Element => {
  const [search, setSearch] = useState('')
  const relationship = navigation.relationshipQuery.data
  const subjectLabel = selected.workingCopy ? 'Current' : selected.shortestChangeId
  const candidates = revisions.filter(revision => matchesRevisionSearch(revision, search)).slice(0, 50)
  const target = relationship?.revisions.find(revision => revision.commitId === relationship.targetCommitId)
  const unavailableLandmark =
    navigation.targetKey !== 'revision' && navigation.comparisonTarget !== undefined && navigation.comparisonTarget.status !== 'resolved'
  const unavailableConnection = relationship?.relation === 'same' || relationship?.relation === 'no-common-ancestor'
  return (
    <section
      aria-label="Revision comparison"
      className="dshx:flex dshx:flex-none dshx:flex-col dshx:gap-1 dshx:border-b dshx:bg-muted/20 dshx:px-3 dshx:py-1.5 dshx:text-xs"
    >
      <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-1.5">
        <strong className="dshx:font-medium">Compare</strong>
        <span className={selected.workingCopy ? 'dshx:font-medium' : 'dshx:font-mono'} title={selected.description}>
          {subjectLabel}
        </span>
        <span className="dshx:text-muted-foreground">with</span>
        <select
          aria-label="Comparison target"
          className={`${SELECT_CLASS} dshx:w-40 dshx:max-w-full`}
          onChange={event => navigation.chooseTarget(event.target.value)}
          value={navigation.targetKey}
        >
          {navigation.landmarks.map(landmark => (
            <option disabled={landmark.status !== 'resolved'} key={landmark.kind} value={landmark.kind}>
              {landmark.label}
              {landmark.status === 'resolved' ? '' : ` (${landmark.status})`}
            </option>
          ))}
          <option value="revision">Another revision…</option>
        </select>
        {target !== undefined && (
          <Button
            aria-label="Locate comparison target"
            onClick={() => onLocate(target)}
            size="icon-xs"
            title="Locate target in graph"
            type="button"
            variant="ghost"
          >
            <LocateFixedIcon aria-hidden />
          </Button>
        )}
        <Button aria-label="Close comparison" onClick={navigation.closeComparison} size="icon-xs" type="button" variant="ghost">
          <XIcon />
        </Button>
      </div>
      {navigation.targetKey === 'revision' && (
        <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-1.5">
          <Input
            aria-label="Find comparison target"
            className="dshx:h-7 dshx:w-40 dshx:max-w-full dshx:text-xs"
            onChange={event => setSearch(event.target.value)}
            placeholder="Search loaded revisions…"
            value={search}
          />
          <select
            aria-label="Choose revision target"
            className={`${SELECT_CLASS} dshx:flex-1`}
            onChange={event => navigation.setCustomTargetId(event.target.value)}
            value={navigation.customTargetId}
          >
            <option value="">Choose revision…</option>
            {candidates.map(revision => (
              <option key={revision.commitId} value={revision.commitId}>
                {revision.shortestChangeId} · {revision.description.split('\n')[0] || '(empty)'}
              </option>
            ))}
          </select>
        </div>
      )}
      {navigation.relationshipQuery.isFetching && (
        <p className="dshx:text-muted-foreground" role="status">
          Reading ancestry…
        </p>
      )}
      {navigation.relationshipQuery.error !== null && (
        <p className="dshx:text-destructive" role="status">
          {errorMessage(navigation.relationshipQuery.error, 'Comparison unavailable. Updated Host required.')}
        </p>
      )}
      {unavailableLandmark && navigation.relationshipQuery.error === null && (
        <p className="dshx:text-muted-foreground" role="status">
          Target unavailable. Choose a resolved landmark.
        </p>
      )}
      {navigation.targetKey === 'revision' && navigation.customTargetId.length === 0 && (
        <p className="dshx:text-muted-foreground" role="status">
          Choose a revision from loaded history to compare.
        </p>
      )}
      {relationship !== undefined && (
        <>
          <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
            <div
              aria-live="polite"
              className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-x-3 dshx:gap-y-1"
              title="Exact revision ancestry counts; not a file or patch comparison."
            >
              <strong className="dshx:font-medium">{GraphNavigationModel.relationshipLabel(relationship.relation)}</strong>
              <span title={`Changes reachable only from ${subjectLabel}`}>
                <strong>{relationship.selectedOnlyCount}</strong> only in {subjectLabel}
              </span>
              <span title={`Changes reachable only from ${navigation.targetLabel}`}>
                <strong>{relationship.targetOnlyCount}</strong> only in {navigation.targetLabel}
              </span>
              <span className="dshx:text-muted-foreground">{relationship.commonAncestorIds.length} shared</span>
            </div>
            <div className="dshx:flex dshx:flex-wrap dshx:gap-1.5">
              <Button disabled={unavailableConnection} onClick={navigation.showConnection} size="xs" type="button" variant="outline">
                Highlight path
              </Button>
              <Button disabled={unavailableConnection} onClick={() => navigation.applyRelationship('connection')} size="xs" type="button" variant="outline">
                Show only path
              </Button>
              <Button
                disabled={relationship.selectedOnlyCount === 0}
                onClick={() => navigation.applyRelationship('difference')}
                size="xs"
                title={relationship.selectedOnlyCount === 0 ? 'No changes exist only on this side.' : 'Show changes on this side that are not in the target.'}
                type="button"
                variant="outline"
              >
                Work since target
              </Button>
            </div>
          </div>
          {relationship.truncated && (
            <p className="dshx:text-warning" role="status">
              View limited to bounded history; ancestry counts remain exact.
            </p>
          )}
        </>
      )}
    </section>
  )
}

interface GraphViewStatusProps {
  readonly navigation: Navigation
  readonly filters: readonly { readonly label: string; readonly clear: () => void }[]
  readonly onReset: () => void
}

export const GraphViewStatus = ({ navigation, filters, onReset }: GraphViewStatusProps): JSX.Element | null => {
  const active = navigation.view !== null || navigation.hidden.length > 0 || navigation.revealed.length > 0 || navigation.lens !== null || filters.length > 0
  if (!active && !navigation.notice && !navigation.sliceMutation.isPending) return null
  return (
    <div aria-label="Graph view status" className="dshx:flex dshx:flex-none dshx:flex-col dshx:gap-1 dshx:border-b dshx:px-3 dshx:py-1.5 dshx:text-xs">
      {active && (
        <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1">
          <span className="dshx:mr-1 dshx:text-muted-foreground">View:</span>
          {navigation.view !== null && (
            <FilterChip label={`${navigation.view.label}${navigation.view.truncated ? ' (limited)' : ''}`} onClear={navigation.clearView} />
          )}
          {navigation.lens !== null && <FilterChip label="Connection highlighted" onClear={navigation.clearLens} />}
          {navigation.hidden.map(history => (
            <FilterChip
              key={history.commitId}
              label={`Hidden: ${history.label}${history.truncated ? ' (limited)' : ''}`}
              onClear={() => navigation.removeHidden(history.commitId)}
            />
          ))}
          {navigation.revealed.length > 0 && <FilterChip label={`${navigation.revealed.length} temporarily revealed`} onClear={navigation.clearRevealed} />}
          {filters.map(filter => (
            <FilterChip key={filter.label} label={filter.label} onClear={filter.clear} />
          ))}
          <Button className="dshx:ml-auto" onClick={onReset} size="xs" type="button" variant="outline">
            Show all
          </Button>
        </div>
      )}
      {navigation.sliceMutation.isPending && <p role="status">Reading graph view…</p>}
      {navigation.notice && (
        <div className="dshx:flex dshx:items-center dshx:gap-2">
          <p className="dshx:min-w-0 dshx:flex-1 dshx:text-muted-foreground" role="status">
            {navigation.notice}
          </p>
          {navigation.hidden.length > 0 && (
            <Button
              onClick={() => {
                const latest = navigation.hidden.at(-1)
                if (latest !== undefined) navigation.removeHidden(latest.commitId)
                navigation.setNotice('')
              }}
              size="xs"
              type="button"
              variant="ghost"
            >
              Undo hide
            </Button>
          )}
          <Button aria-label="Dismiss graph notice" onClick={() => navigation.setNotice('')} size="icon-xs" type="button" variant="ghost">
            <XIcon />
          </Button>
        </div>
      )}
    </div>
  )
}

const FilterChip = ({ label, onClear }: { readonly label: string; readonly onClear: () => void }): JSX.Element => (
  <Button aria-label={`Remove ${label}`} className="dshx:max-w-full dshx:min-w-0" onClick={onClear} size="xs" type="button" variant="secondary">
    <span className="dshx:truncate">{label}</span>
    <XIcon aria-hidden className="dshx:size-3" />
  </Button>
)

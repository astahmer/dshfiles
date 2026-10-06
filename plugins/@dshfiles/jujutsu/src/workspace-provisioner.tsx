import { useEffect, useState } from 'react'
import { workspaceNameSchema, type Mutation, type Revision } from './api.js'
import styles from './jujutsu.module.css'

interface WorkspaceProvisionerProps {
  readonly revisions: readonly Revision[]
  readonly selectedCommitId: string | null
  readonly provisionedPath: string | null
  readonly onPreview: (action: Mutation) => void
  readonly pickDirectory: () => Promise<string | null>
  readonly launchSession: (cwd: string) => Promise<void>
}

export const WorkspaceProvisioner = (props: WorkspaceProvisionerProps): JSX.Element => {
  const [parentPath, setParentPath] = useState('')
  const [name, setName] = useState('')
  const [baseCommitId, setBaseCommitId] = useState('')
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (props.revisions.length === 0) {
      setBaseCommitId('')
      return
    }
    setBaseCommitId(current => {
      if (props.revisions.some(revision => revision.commitId === current)) return current
      return props.selectedCommitId ?? props.revisions.find(revision => revision.workingCopy)?.commitId ?? props.revisions[0]?.commitId ?? ''
    })
  }, [props.revisions, props.selectedCommitId])

  const chooseParent = async (): Promise<void> => {
    setError(null)
    try {
      const selected = await props.pickDirectory()
      if (selected !== null) setParentPath(selected)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not choose a parent directory.')
    }
  }

  const createSession = async (): Promise<void> => {
    if (props.provisionedPath === null) return
    setLaunching(true)
    setError(null)
    try {
      await props.launchSession(props.provisionedPath)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Workspace Session could not be opened.')
    } finally {
      setLaunching(false)
    }
  }

  const validName = workspaceNameSchema.safeParse(name).success
  const canPreview = parentPath.length > 0 && validName && baseCommitId.length > 0

  return (
    <section className={styles.sessionTools} aria-labelledby="jj-workspace-provision-title">
      <h2 id="jj-workspace-provision-title">Provision an isolated workspace</h2>
      <p className={styles.muted}>JJ adds a sibling workspace at the chosen revision. This repository’s current working files stay in place.</p>
      <div className={styles.sessionToolGrid}>
        <label>
          Base revision
          <select aria-label="Workspace base revision" value={baseCommitId} onChange={event => setBaseCommitId(event.target.value)}>
            {props.revisions.map(revision => (
              <option key={revision.commitId} value={revision.commitId}>
                {revision.shortestChangeId} · {revision.description.split('\n')[0] || '(no description)'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Workspace name
          <input aria-label="Workspace name" value={name} onChange={event => setName(event.target.value)} placeholder="review-feature" />
        </label>
        <button type="button" className={styles.secondary} onClick={() => void chooseParent()}>
          Choose parent directory
        </button>
        <span className={styles.sessionPath} title={parentPath || undefined}>
          {parentPath || 'No parent directory selected'}
        </span>
        <button
          type="button"
          disabled={!canPreview || props.revisions.length === 0}
          onClick={() => void props.onPreview({ kind: 'workspace-add', parentPath, name, commitId: baseCommitId })}
        >
          Preview workspace setup
        </button>
      </div>
      {props.provisionedPath !== null && (
        <div className={styles.sessionToolAction}>
          <span className={styles.sessionPath} title={props.provisionedPath}>Created: {props.provisionedPath}</span>
          <button type="button" className={styles.secondary} disabled={launching} onClick={() => void createSession()}>
            {launching ? 'Opening…' : 'Open a DSH Session here'}
          </button>
        </div>
      )}
      {error !== null && <p className={styles.sessionToolError} role="alert">{error}</p>}
    </section>
  )
}

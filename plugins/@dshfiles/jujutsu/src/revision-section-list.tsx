import { useRegistry } from '@dshfiles/dshx/client'
import { RevisionSections, type RevisionSectionTarget } from '@dshfiles/jj-integration/revision-sections'

/** What other plugins add under a revision's details (`RevisionSections`); nothing when none is registered. */
export const RevisionSectionList = (props: RevisionSectionTarget): JSX.Element | null => {
  const sections = useRegistry(RevisionSections)
  if (sections.length === 0) return null
  return (
    <>
      {[...sections]
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
        .map(section => (
          <section.Component key={section.id} repositoryRoot={props.repositoryRoot} changeId={props.changeId} commitId={props.commitId} />
        ))}
    </>
  )
}

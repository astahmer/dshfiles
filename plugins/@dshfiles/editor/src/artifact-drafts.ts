export interface ArtifactDraftSource {
  readonly id: string
  readonly title: string
  readonly mimeType: string
  readonly revision: number
  readonly content: string
}

export interface ArtifactDraft {
  readonly artifact: ArtifactDraftSource
  readonly title: string
  readonly content: string
}

export const createArtifactDrafts = () => {
  const drafts = new Map<string, ArtifactDraft>()
  return {
    open: (artifact: ArtifactDraftSource): void => {
      if (!drafts.has(artifact.id)) drafts.set(artifact.id, { artifact, title: artifact.title, content: artifact.content })
    },
    get: (id: string): ArtifactDraft | undefined => drafts.get(id),
    capture: (id: string, title: string, content: string): void => {
      const current = drafts.get(id)
      if (current !== undefined) drafts.set(id, { ...current, title, content })
    },
    saved: (artifact: ArtifactDraftSource): void => {
      const current = drafts.get(artifact.id)
      if (current !== undefined) drafts.set(artifact.id, { ...current, artifact })
    },
    reload: (artifact: ArtifactDraftSource): void => {
      drafts.set(artifact.id, { artifact, title: artifact.title, content: artifact.content })
    },
    delete: (id: string): void => {
      drafts.delete(id)
    },
  }
}

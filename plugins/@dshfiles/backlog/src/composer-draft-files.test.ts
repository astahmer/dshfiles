import { afterEach, describe, expect, it } from 'vitest'

import { composerDraftFiles } from './composer-attachments.js'
import type { ComposerFile } from './composer-files.js'

const draftKey = 'feed-test'

afterEach(() => composerDraftFiles.set(draftKey, []))

describe('backlog composer attachment drafts', () => {
  it('keeps large attachments when the composer unmounts and mounts again', () => {
    const file: ComposerFile = {
      id: 'attachment-1',
      kind: 'image',
      name: 'large screenshot.png',
      mediaType: 'image/png',
      bytes: 6 * 1024 * 1024,
      width: 1600,
      height: 1200,
      dataUrl: `data:image/png;base64,${'A'.repeat(6 * 1024 * 1024)}`,
    }

    composerDraftFiles.set(draftKey, [file])

    expect(composerDraftFiles.get(draftKey)).toEqual([file])
    expect(composerDraftFiles.get(draftKey)[0]?.dataUrl).toBe(file.dataUrl)
  })

  it('isolates attachments by draft key and removes the draft when cleared', () => {
    const file: ComposerFile = {
      id: 'attachment-2',
      kind: 'file',
      name: 'notes.txt',
      mediaType: 'text/plain',
      bytes: 5,
      dataUrl: 'data:text/plain;base64,aGVsbG8=',
    }
    composerDraftFiles.set(draftKey, [file])

    expect(composerDraftFiles.get('another-draft')).toEqual([])
    composerDraftFiles.set(draftKey, [])
    expect(composerDraftFiles.get(draftKey)).toEqual([])
  })
})

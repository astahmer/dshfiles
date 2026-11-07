import { PlatformError } from 'effect'
import { describe, expect, it } from 'vitest'
import { WorkspaceFilesFailed } from './errors.js'

const deepPath = `/private/tmp/${'nested/'.repeat(40)}repo-threads/thread-aaaaaa`

describe('WorkspaceFilesFailed.message', () => {
  it('names the file-system reason once, without repeating a long path the detail already names', () => {
    const cause = new PlatformError.PlatformError(
      new PlatformError.SystemError({ _tag: 'PermissionDenied', module: 'FileSystem', method: 'remove', pathOrDescriptor: deepPath }),
    )
    const message = new WorkspaceFilesFailed({ detail: `Could not remove ${deepPath}.`, cause }).message

    expect(message).toBe(`Could not remove ${deepPath}. PermissionDenied`)
    expect(message.split(deepPath)).toHaveLength(2)
  })

  it('keeps a platform description and a plain error message, and adds nothing without a cause', () => {
    const described = new PlatformError.PlatformError(
      new PlatformError.SystemError({ _tag: 'Busy', module: 'FileSystem', method: 'remove', pathOrDescriptor: deepPath, description: 'resource busy' }),
    )
    expect(new WorkspaceFilesFailed({ detail: 'Could not remove it.', cause: described }).message).toBe('Could not remove it. Busy: resource busy')
    expect(new WorkspaceFilesFailed({ detail: 'Could not remove it.', cause: new Error('EIO') }).message).toBe('Could not remove it. EIO')
    expect(new WorkspaceFilesFailed({ detail: 'Could not remove it.' }).message).toBe('Could not remove it.')
  })
})

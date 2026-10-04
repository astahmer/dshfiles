import { access, constants } from 'node:fs/promises'
import { BrowserWindow, app, dialog, shell } from 'electron'
import { resolveDshExecutable, startHost, type HostSession } from './host.js'

/**
 * The desktop shell.
 *
 * A window pointed at a Host this process owns. Nothing here re-implements DSH's
 * client: the renderer is DSH's own bundle, loaded from the Host, so the app
 * cannot drift from what the Host can do.
 *
 * The launch URL is handed to the window and then forgotten. The window performs
 * the token exchange itself and holds the resulting cookie, which is what makes
 * this safe to ship — no credential is ever handled by this file.
 */

const PROFILE = process.env['DSH_DESKTOP_PROFILE'] ?? 'web'

let session: HostSession | undefined
let quitting = false

const isExecutable = async (directory: string): Promise<boolean> => {
  try {
    await access(`${directory}/dsh`, constants.X_OK)
    return true
  } catch {
    // A missing directory is the common case while walking PATH, not an error.
    return false
  }
}

const fail = async (message: string): Promise<never> => {
  await dialog.showErrorBox('DSH could not start', message)
  app.quit()
  // `app.quit` is not synchronous, so nothing after it may touch a window that
  // was never created. Waiting forever is how that is expressed.
  return new Promise<never>(() => {})
}

const openWindow = async (): Promise<void> => {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: 'DSH',
    backgroundColor: '#151517',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once('ready-to-show', () => {
    window.show()
  })

  // The Host owns navigation. Anything else opens in the user's browser rather
  // than inside a window with no chrome for it.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // A failed load would otherwise leave a blank frame with no explanation.
  window.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    if (!isMainFrame || code === -3) return
    // The token is stripped from anything shown to the user.
    const authority = validatedURL.split('?')[0] ?? validatedURL
    void dialog.showErrorBox('DSH could not be loaded', `${description} (${code})\n\n${authority}`)
  })

  const launchUrl = session?.launchUrl
  if (launchUrl === undefined) {
    await fail('The Host started but no launch URL was available.')
    return
  }
  await window.loadURL(launchUrl)
  // The window now holds the cookie this URL was exchanged for, so the URL has no
  // further use and is dropped rather than left reachable from this process.
  session?.forgetLaunchUrl()
}

void app.whenReady().then(async () => {
  const executable = await resolveDshExecutable(isExecutable, process.env['PATH'] ?? '').catch(
    (error: unknown) =>
      fail(
        `${String(error instanceof Error ? error.message : error)}\n\nThe directory containing dsh is usually added by your shell profile, which a Finder-launched app does not read.`,
      ),
  )

  session = await startHost({ profile: PROFILE, executable }).catch((error: unknown) =>
    fail(
      `The DSH Host for profile "${PROFILE}" did not start.\n\n${String(error instanceof Error ? error.message : error)}`,
    ),
  )

  await openWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void app.quit()
  })
})

/**
 * Stop the Host when the app goes away.
 *
 * v1 ties the Host's lifetime to the window rather than copying the service-unit
 * approach a shell over a separate daemon would need, so quitting really does
 * release the port and the data directory.
 */
app.on('before-quit', event => {
  const stopping = session
  if (quitting || stopping === undefined) return
  quitting = true
  event.preventDefault()
  session = undefined
  void stopping.stop().finally(() => {
    app.quit()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
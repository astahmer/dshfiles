import { defineClientPlugin, Dialogs, Overlay, Toasts } from '@dshfiles/dshx/client'
import { DialogHost } from './dialog-host.js'
import { createDialogQueue } from './dialog-queue.js'
import { createToastStack } from './toast-stack.js'
import { ToastView } from './toast-view.js'

export default defineClientPlugin({
  id: 'dshfiles-dialogs',
  name: '@dshfiles/dialogs',
  uses: ['ui'],
  setup(api) {
    const queue = createDialogQueue()
    const stack = createToastStack()
    api.onDispose(() => {
      queue.dispose()
      stack.dispose()
    })
    api.provide(Dialogs, queue.service)
    api.provide(Toasts, stack.service)
    api.add(Overlay, {
      id: 'dshfiles-dialogs',
      component: () => (
        <>
          <DialogHost current={queue.current} />
          <ToastView stack={stack} />
        </>
      ),
    })
  },
})

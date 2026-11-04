import { defineRegistry } from '@dshfiles/dshx/client'
import type { PanelTitle } from './registry.js'

/**
 * Person-readable main-panel tab titles a plugin provides (see `PanelTitle` in `./registry`). Kept out of the
 * `registry` module on purpose: that module is type-imported by native forks (rich-composer) whose own conversation
 * contract would collide with the native types `@dshfiles/dshx/client` pulls in.
 */
export const PanelTitles = defineRegistry<PanelTitle>('@dshfiles/workbench.panel-title')

/**
 * The layout package is browser-only: the frame, its geometry store and the
 * theme presenter all live in the client half, exactly as upstream's no-op Host
 * entry. The row still needs a Host module to load, and a native named export
 * keeps this module free of toolchain-only dependencies.
 */
export { apply } from './native/index.js'

/**
 * CSS modules resolve to a class-name map.
 *
 * A global script, because TypeScript rejects a wildcard pattern as an
 * augmentation target inside a module. A plugin stops carrying its own shim by
 * importing `@dshfiles/dshx/client`, whose types reference this file.
 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

/** Plain stylesheets (e.g. a Tailwind entry) are side-effect imports. */
declare module '*.css' {}

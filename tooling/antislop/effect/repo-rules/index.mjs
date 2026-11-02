import { hostFiles, repositoryRootOf } from '../host-files.mjs'

const normalizePath = value => String(value).replaceAll('\\', '/')

const memberName = node => {
  if (node?.computed) return undefined
  return node?.property?.type === 'Identifier' ? node.property.name : undefined
}

const perFile = compute => {
  const cache = new WeakMap()
  return context => {
    const key = context.sourceCode.ast
    if (!cache.has(key)) cache.set(key, compute(context))
    return cache.get(key)
  }
}

const effectImports = perFile(context => {
  const imports = new Map()
  for (const statement of context.sourceCode.ast.body) {
    if (statement.type !== 'ImportDeclaration' || statement.source.value !== 'effect') continue
    for (const specifier of statement.specifiers) {
      if (specifier.type === 'ImportNamespaceSpecifier') {
        imports.set(specifier.local.name, '*')
        continue
      }
      if (specifier.type !== 'ImportSpecifier') continue
      const imported = specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value
      imports.set(specifier.local.name, imported)
    }
  }
  return imports
})

const effectNamespaceName = (object, imports) => {
  if (object?.type === 'Identifier') return imports.get(object.name) ?? object.name
  if (object?.type === 'MemberExpression' && object.object?.type === 'Identifier' && imports.get(object.object.name) === '*') return memberName(object)
  return undefined
}

const isMemberCall = (node, objectName, methodNames, imports = new Map()) => {
  if (node?.type !== 'CallExpression' || node.callee?.type !== 'MemberExpression') return false
  const method = memberName(node.callee)
  const namespace = effectNamespaceName(node.callee.object, imports)
  return (namespace === objectName || (namespace === '*' && objectName === 'Effect' && methodNames.has(method))) && methodNames.has(method)
}

const isEffectLift = (node, context) => isMemberCall(node, 'Effect', new Set(['promise', 'tryPromise']), effectImports(context))
const isEffectProgram = (node, context) =>
  isMemberCall(
    node,
    'Effect',
    new Set([
      'fn',
      'gen',
      'sync',
      'try',
      'promise',
      'tryPromise',
      'fail',
      'failSync',
      'map',
      'flatMap',
      'catch',
      'catchTag',
      'catchIf',
      'mapError',
      'tapError',
    ]),
    effectImports(context),
  )
const isRun = (node, context) => isMemberCall(node, 'Effect', new Set(['runPromise', 'runPromiseExit', 'runSync', 'runSyncExit']), effectImports(context))

const visit = (node, predicate, { crossFunctions = true } = {}) => {
  if (node === null || typeof node !== 'object') return false
  if (predicate(node)) return true
  if (!crossFunctions && ['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression'].includes(node.type)) return false
  return Object.entries(node).some(([key, value]) => {
    if (key === 'parent') return false
    return Array.isArray(value) ? value.some(child => visit(child, predicate, { crossFunctions })) : visit(value, predicate, { crossFunctions })
  })
}

const effectMethods = new Set(['fail', 'failSync', 'fn', 'flatMap', 'gen', 'map', 'promise', 'runPromise', 'sleep', 'succeed', 'sync', 'try', 'tryPromise'])

const hasEffectApiCall = (node, context) => {
  const imports = effectImports(context)
  return visit(node, child => {
    if (child.type !== 'CallExpression' || child.callee?.type !== 'MemberExpression') return false
    const namespace = effectNamespaceName(child.callee.object, imports)
    return ['Effect', 'Stream', 'DateTime', 'Duration'].includes(namespace) || (namespace === '*' && effectMethods.has(memberName(child.callee)))
  })
}

const isEffectSource = perFile(context => {
  const filename = normalizePath(context.getFilename())
  const inEffectPaths =
    (filename.includes('/plugins/@dshfiles/') && filename.includes('/src/')) ||
    filename.includes('/tooling/dshx/packages/dshx/src/effect/') ||
    filename.includes('/tooling/antislop/effect/repo-rules/fixtures/')
  const importsEffect = /from\s*['"]effect['"]/u.test(context.sourceCode.text)
  return inEffectPaths && importsEffect && !/(?:\.test|\.spec|\.bench)\.[cm]?[jt]sx?$/u.test(filename)
})

const callsByCallee = perFile(context => {
  const calls = []
  visit(context.sourceCode.ast, node => {
    if (node.type === 'CallExpression') calls.push(node)
    return false
  })
  return calls
})

const declaratorInitializers = perFile(context => {
  const initializers = new Map()
  visit(context.sourceCode.ast, node => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') initializers.set(node.id.name, node.init)
    return false
  })
  return initializers
})

const isHostFactory = node => {
  const callee = node.callee
  return (
    (callee?.type === 'Identifier' && callee.name === 'hostApi') ||
    (callee?.type === 'MemberExpression' && callee.object?.type === 'Identifier' && callee.object.name === 'DshxEffect' && memberName(callee) === 'host')
  )
}

const enclosingFunctionName = node => {
  let current = node.parent
  while (current !== undefined && current !== null) {
    if (current.type === 'FunctionDeclaration') return current.id?.name
    if (['ArrowFunctionExpression', 'FunctionExpression'].includes(current.type)) {
      if (current.parent?.type === 'VariableDeclarator' && current.parent.id.type === 'Identifier') return current.parent.id.name
      return undefined
    }
    current = current.parent
  }
  return undefined
}

const hostHandlersObject = (argument, context) => {
  if (argument?.type === 'ObjectExpression') return argument
  if (argument?.type !== 'Identifier') return undefined
  const initializer = declaratorInitializers(context).get(argument.name)
  return initializer?.type === 'ObjectExpression' ? initializer : undefined
}

const hostHandlerObjects = perFile(context =>
  callsByCallee(context)
    .filter(isHostFactory)
    .map(call => hostHandlersObject(call.arguments[1], context))
    .filter(handlers => handlers !== undefined),
)

const isHostHandler = (node, context) => {
  let current = node.parent
  while (current !== undefined && current !== null) {
    if (current.type === 'CallExpression' && isHostFactory(current) && current.arguments[1]?.start <= node.start && node.end <= current.arguments[1]?.end)
      return true
    current = current.parent
  }

  const name = enclosingFunctionName(node)
  return hostHandlerObjects(context).some(
    handlers =>
      (handlers.start <= node.start && node.end <= handlers.end) ||
      (name !== undefined &&
        handlers.properties.some(property => property.type === 'Property' && property.value?.type === 'Identifier' && property.value.name === name)),
  )
}

const isLayerFactoryFunction = node => {
  const name =
    node.type === 'FunctionDeclaration'
      ? node.id?.name
      : node.parent?.type === 'VariableDeclarator' && node.parent.id.type === 'Identifier'
        ? node.parent.id.name
        : undefined
  return name?.endsWith('Layer') === true || (node.parent?.type === 'Property' && node.parent.key?.name === 'layer')
}

const hasRootLayerFactory = perFile(context => {
  const imports = effectImports(context)
  return callsByCallee(context).some(node => isMemberCall(node, 'Layer', new Set(['effect', 'scoped', 'sync', 'succeed']), imports))
})

const insideRootLayer = (node, context) => {
  let current = node.parent
  while (current !== undefined && current !== null) {
    if (isLayerFactoryFunction(current)) return true
    if (isMemberCall(current, 'Layer', new Set(['effect', 'scoped', 'sync', 'succeed']), effectImports(context))) return true
    current = current.parent
  }
  return false
}

const layerHelperName = node => {
  let current = node.parent
  while (current !== undefined && current !== null) {
    if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(current.type)) {
      if (current.type === 'FunctionDeclaration') return current.id?.name
      if (current.parent?.type === 'VariableDeclarator' && current.parent.id.type === 'Identifier') return current.parent.id.name
      return undefined
    }
    current = current.parent
  }
  return undefined
}

const isRootLayerHelper = (node, context) => {
  const name = layerHelperName(node)
  if (name === undefined) return false
  const calls = callsByCallee(context).filter(child => child.callee?.type === 'Identifier' && child.callee.name === name)
  return calls.length > 0 && calls.every(call => insideRootLayer(call, context))
}

const insideEffectTryBody = (node, context) => {
  let current = node.parent
  while (current !== undefined && current !== null) {
    if (isMemberCall(current, 'Effect', new Set(['try', 'tryPromise']), effectImports(context))) {
      const options = current.arguments[0]
      if (options?.type !== 'ObjectExpression') return false
      const tryProperty = options.properties.find(
        property => property.type === 'Property' && property.key?.type === 'Identifier' && property.key.name === 'try',
      )
      return tryProperty?.value?.start <= node.start && node.end <= tryProperty.value.end
    }
    current = current.parent
  }
  return false
}

const insideEffectProgram = (node, context) => {
  let current = node.parent
  while (current !== undefined && current !== null) {
    if (isEffectProgram(current, context)) return true
    current = current.parent
  }
  return false
}

const taggedErrorCallee = (node, context) => {
  let callee = node.callee
  if (callee?.type === 'TSInstantiationExpression') callee = callee.expression
  return (
    callee?.type === 'MemberExpression' &&
    callee.object?.type === 'Identifier' &&
    (effectImports(context).get(callee.object.name) ?? callee.object.name) === 'Schema' &&
    memberName(callee) === 'TaggedError'
  )
}

const isTimerResourceRelease = (release, node) => {
  const parameter = release?.type === 'ArrowFunctionExpression' || release?.type === 'FunctionExpression' ? release.params[0] : undefined
  if (parameter?.type !== 'Identifier') return false
  return visit(
    release,
    child =>
      child.type === 'CallExpression' &&
      child.callee?.type === 'Identifier' &&
      ['clearTimeout', 'clearInterval'].includes(child.callee.name) &&
      child.arguments[0]?.type === 'Identifier' &&
      child.arguments[0].name === parameter.name,
  )
}

const insideEffectResourceScope = (node, context) => {
  let current = node.parent
  const imports = effectImports(context)
  while (current !== undefined && current !== null) {
    if (isMemberCall(current, 'Effect', new Set(['acquireRelease', 'acquireUseRelease']), imports)) {
      const acquisition = current.arguments[0]
      const release = current.arguments[current.callee.property.name === 'acquireRelease' ? 1 : 2]
      if (acquisition?.start <= node.start && node.end <= acquisition.end && isTimerResourceRelease(release, node)) return true
    }
    current = current.parent
  }
  return false
}

const testFilePattern = /(?:\.test|\.spec|\.bench)\.[cm]?[jt]sx?$/u
const fixturesPath = '/tooling/antislop/effect/repo-rules/fixtures/'

const importsEffect = context => /from\s*['"]effect(?:\/[^'"]*)?['"]/u.test(context.sourceCode.text)

const isOwnedEffectSource = perFile(context => {
  const filename = normalizePath(context.getFilename())
  const owned = /\/plugins\/@dshfiles\/[^/]+\/src\//u.test(filename) || filename.includes('/tooling/dshx/packages/dshx/src/') || filename.includes(fixturesPath)
  return owned && !filename.includes('/src/native/') && importsEffect(context) && !testFilePattern.test(filename)
})

const isHostSource = perFile(context => {
  const filename = normalizePath(context.getFilename())
  if (testFilePattern.test(filename) || filename.includes('/src/native/')) return false
  if (filename.includes(fixturesPath) || filename.includes('/tooling/dshx/packages/dshx/src/effect/')) return true
  const repositoryRoot = repositoryRootOf(filename)
  return repositoryRoot !== undefined && hostFiles(repositoryRoot).has(filename)
})

const isFunctionNode = node => node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression'

const objectProperty = (object, name) =>
  object?.type === 'ObjectExpression'
    ? object.properties.find(
        property =>
          property.type === 'Property' &&
          ((property.key?.type === 'Identifier' && property.key.name === name) || (property.key?.type === 'Literal' && property.key.value === name)),
      )
    : undefined

const returnedExpression = fn => {
  if (!isFunctionNode(fn)) return undefined
  if (fn.body?.type !== 'BlockStatement') return fn.body
  const statements = fn.body.body
  return statements.length === 1 && statements[0].type === 'ReturnStatement' ? statements[0].argument : undefined
}

const referencesIdentifier = (node, name) => visit(node, child => child.type === 'Identifier' && child.name === name)

const catchDropsCause = fn => {
  if (!isFunctionNode(fn)) return false
  const parameter = fn.params[0]
  if (parameter === undefined) return true
  if (parameter.type !== 'Identifier') return false
  const returned = returnedExpression(fn)
  if (returned?.type === 'Identifier' && returned.name === parameter.name) return true
  return !referencesIdentifier(fn.body, parameter.name)
}

const isEffectCall = (node, methods, context) => isMemberCall(node, 'Effect', new Set(methods), effectImports(context))

const unwrapExpression = node => {
  let current = node
  while (current?.type === 'TSAsExpression' || current?.type === 'TSSatisfiesExpression' || current?.type === 'ParenthesizedExpression')
    current = current.expression
  return current
}

const fallibleLifts = ['try', 'tryPromise', 'promise']
const recoveringPipeSteps = new Set([
  'catch',
  'catchCause',
  'catchTag',
  'catchTags',
  'catchIf',
  'catchReason',
  'catchReasons',
  'catchDefect',
  'ignore',
  'ignoreCause',
  'orElseSucceed',
  'retry',
  'exit',
  'result',
  'option',
  'either',
  'sandbox',
])

const isRecoveringStep = (node, context) => {
  const step = node?.type === 'CallExpression' ? node.callee : node
  if (step?.type !== 'MemberExpression') return false
  return effectNamespaceName(step.object, effectImports(context)) === 'Effect' && recoveringPipeSteps.has(memberName(step))
}

const isUncaughtFallible = (expression, context, depth = 0) => {
  const node = unwrapExpression(expression)
  if (node === undefined || node === null || depth > 3) return false
  if (isEffectCall(node, fallibleLifts, context)) return true
  if (node.type === 'Identifier') return isUncaughtFallible(declaratorInitializers(context).get(node.name), context, depth + 1)
  if (node.type === 'CallExpression' && node.callee?.type === 'Identifier') {
    const initializer = declaratorInitializers(context).get(node.callee.name)
    return isFunctionNode(initializer) && isUncaughtFallible(returnedExpression(initializer), context, depth + 1)
  }
  if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && memberName(node.callee) === 'pipe') {
    if (node.arguments.some(argument => isRecoveringStep(argument, context))) return false
    return isUncaughtFallible(node.callee.object, context, depth + 1)
  }
  return false
}

const repeatingSteps = new Set(['repeat', 'forever', 'repeatOrElse'])

const spanNamePattern = /^[a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)+$/u

const staticString = node => {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0]?.value.cooked
  return undefined
}

const isPluginFactory = node => {
  const callee = node.callee
  if (callee?.type !== 'MemberExpression' || callee.object?.type !== 'Identifier') return false
  const method = memberName(callee)
  return (callee.object.name === 'DshxEffect' && method === 'plugin') || (callee.object.name === 'DshxPlugin' && method === 'make')
}

const isThenChain = node => {
  let current = unwrapExpression(node)
  while (current?.type === 'CallExpression' && current.callee?.type === 'MemberExpression') {
    if (memberName(current.callee) === 'then') return true
    current = unwrapExpression(current.callee.object)
  }
  return false
}

const childProcessModules = new Set(['node:child_process', 'child_process'])

const plugin = {
  meta: { name: 'effect-migration' },
  rules: {
    'no-effect-api-promise-lift': {
      create(context) {
        return {
          CallExpression(node) {
            if (!isEffectSource(context) || !isEffectLift(node, context)) return
            if (!hasEffectApiCall(node.arguments[0], context)) return
            context.report({
              node,
              message:
                'Do not lift an existing Effect API through Effect.promise/tryPromise; compose its Effect directly so interruption and typed failures are preserved.',
            })
          },
        }
      },
    },
    'no-try-catch-around-effect': {
      create(context) {
        return {
          TryStatement(node) {
            if (!isEffectSource(context) || node.handler === null) return
            if (!visit(node.block, child => isRun(child, context) || (child.type === 'YieldExpression' && child.delegate), { crossFunctions: false })) return
            context.report({
              node,
              message: 'Do not use try/catch to handle an Effect failure; compose with Effect.catch/catchTag and keep the failure typed.',
            })
          },
        }
      },
    },
    'require-curried-tagged-error': {
      create(context) {
        return {
          CallExpression(node) {
            if (!isEffectSource(context) || !taggedErrorCallee(node, context) || node.arguments.length === 0) return
            context.report({ node, message: 'Construct Schema.TaggedError with the curried form Schema.TaggedError<T>()("Tag", fields).' })
          },
        }
      },
    },
    'no-raw-error-in-effect': {
      create(context) {
        return {
          NewExpression(node) {
            if (!isEffectSource(context) || node.callee?.type !== 'Identifier' || node.callee.name !== 'Error') return
            if (!insideEffectProgram(node, context) || insideEffectTryBody(node, context)) return
            context.report({ node, message: 'Avoid ad-hoc new Error inside an Effect; use a qualified Schema.TaggedError so failures stay typed.' })
          },
        }
      },
    },
    'no-unscoped-plugin-timer': {
      create(context) {
        return {
          CallExpression(node) {
            if (!isEffectSource(context) || node.callee?.type !== 'Identifier' || !['setTimeout', 'setInterval'].includes(node.callee.name)) return
            if (!insideEffectProgram(node, context) || insideEffectResourceScope(node, context)) return
            context.report({
              node,
              message:
                'Timers created inside Effect programs must be acquired and cleared together; prefer Clock/Schedule or pair Effect.acquireRelease acquisition with its clearTimeout/clearInterval release.',
            })
          },
        }
      },
    },
    'no-run-promise-in-host-handler': {
      create(context) {
        return {
          CallExpression(node) {
            if (!isEffectSource(context) || !isRun(node, context) || !isHostHandler(node, context)) return
            context.report({ node, message: 'A DshxEffect.host/hostApi handler must return its Effect; do not execute it with Effect.runPromise.' })
          },
        }
      },
    },
    'no-cordis-get-outside-root-layer': {
      create(context) {
        return {
          CallExpression(node) {
            if (!isEffectSource(context) || !hasRootLayerFactory(context) || node.callee?.type !== 'MemberExpression') return
            if (node.callee.object?.type !== 'Identifier' || node.callee.object.name !== 'ctx' || memberName(node.callee) !== 'get') return
            if (insideRootLayer(node, context) || isRootLayerHelper(node, context)) return
            context.report({
              node,
              message: 'Read Cordis ctx.get dependencies only in the root Layer factory; provide typed Effect services to the rest of the plugin.',
            })
          },
        }
      },
    },
    'no-cause-dropping-catch': {
      create(context) {
        return {
          CallExpression(node) {
            if (!isOwnedEffectSource(context) || !isEffectCall(node, ['try', 'tryPromise'], context)) return
            const handler = objectProperty(node.arguments[0], 'catch')?.value
            if (!catchDropsCause(handler)) return
            context.report({
              node: handler,
              message:
                'This Effect.try/tryPromise catch drops or leaks the raw cause; map it into a Schema.TaggedError with cause: Schema.optional(Schema.Defect()) and bounded identity fields.',
            })
          },
        }
      },
    },
    'no-empty-plugin-layer': {
      create(context) {
        return {
          CallExpression(node) {
            if (!isOwnedEffectSource(context) || !isPluginFactory(node)) return
            const layer = unwrapExpression(objectProperty(node.arguments[0], 'layer')?.value)
            if (layer?.type !== 'MemberExpression' || layer.object?.type !== 'Identifier' || layer.object.name !== 'Layer' || memberName(layer) !== 'empty')
              return
            context.report({
              node: layer,
              message: 'A plugin with layer: Layer.empty owns nothing in its runtime; build its services as a Layer graph from HostContext.',
            })
          },
        }
      },
    },
    'no-gen-inside-fn': {
      create(context) {
        return {
          CallExpression(node) {
            if (!isOwnedEffectSource(context) || !isEffectCall(node.callee, ['fn'], context)) return
            const body = node.arguments[0]
            if (!isEffectCall(unwrapExpression(returnedExpression(body)), ['gen'], context)) return
            context.report({
              node: body,
              message: 'Effect.fn already runs a generator; pass function* (params) { … } directly instead of wrapping Effect.gen in an arrow.',
            })
          },
        }
      },
    },
    'no-repeat-over-uncaught-effect': {
      create(context) {
        return {
          CallExpression(node) {
            if (!isOwnedEffectSource(context)) return
            if (isEffectCall(node, [...repeatingSteps], context) && node.arguments.length > 0 && isUncaughtFallible(node.arguments[0], context)) {
              context.report({
                node,
                message:
                  'A repeated/forever Effect stops at its first failure; recover inside the loop (Effect.catch/catchCause/ignore) or retry so the background work keeps running.',
              })
              return
            }
            if (node.callee?.type !== 'MemberExpression' || memberName(node.callee) !== 'pipe') return
            const repeatIndex = node.arguments.findIndex(argument => {
              const step = argument?.type === 'CallExpression' ? argument.callee : argument
              return (
                step?.type === 'MemberExpression' &&
                effectNamespaceName(step.object, effectImports(context)) === 'Effect' &&
                repeatingSteps.has(memberName(step))
              )
            })
            if (repeatIndex === -1) return
            if (node.arguments.slice(0, repeatIndex).some(argument => isRecoveringStep(argument, context))) return
            if (!isUncaughtFallible(node.callee.object, context)) return
            context.report({
              node,
              message:
                'A repeated/forever Effect stops at its first failure; recover inside the loop (Effect.catch/catchCause/ignore) or retry so the background work keeps running.',
            })
          },
        }
      },
    },
    'no-host-module-state': {
      create(context) {
        const report = node =>
          context.report({
            node,
            message:
              'Host modules must not hold mutable or per-Context state; keep it in a service built by the plugin Layer (Ref, SynchronizedRef, FiberMap, Cache) so it lives and dies with the plugin scope.',
          })
        return {
          Program(program) {
            if (!isHostSource(context)) return
            for (const statement of program.body) {
              const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
              if (declaration?.type === 'VariableDeclaration' && declaration.kind !== 'const') report(declaration)
            }
          },
          NewExpression(node) {
            if (!isHostSource(context) || node.callee?.type !== 'Identifier' || node.callee.name !== 'WeakMap') return
            if (!/^new\s+WeakMap\s*<\s*(?:[A-Za-z_$][\w$]*\.)?Context\b/u.test(context.sourceCode.getText(node))) return
            report(node)
          },
        }
      },
    },
    'no-host-global-timer': {
      create(context) {
        return {
          CallExpression(node) {
            if (!isHostSource(context)) return
            const callee = node.callee
            const name =
              callee?.type === 'Identifier'
                ? callee.name
                : callee?.type === 'MemberExpression' && callee.object?.type === 'Identifier' && callee.object.name === 'globalThis'
                  ? memberName(callee)
                  : undefined
            if (name !== 'setTimeout' && name !== 'setInterval') return
            context.report({
              node,
              message: 'Host code schedules work with Effect.sleep, Schedule or Clock inside a scoped fiber, not global setTimeout/setInterval.',
            })
          },
        }
      },
    },
    'no-host-child-process': {
      create(context) {
        const check = (node, source) => {
          if (!isHostSource(context) || !childProcessModules.has(source)) return
          context.report({ node, message: 'Host code spawns processes through the DSH-backed ChildProcessSpawner service, not node:child_process.' })
        }
        return {
          ImportDeclaration(node) {
            check(node, node.source.value)
          },
          ImportExpression(node) {
            check(node, staticString(node.source))
          },
        }
      },
    },
    'no-void-then': {
      create(context) {
        return {
          UnaryExpression(node) {
            if (node.operator !== 'void' || !importsEffect(context) || testFilePattern.test(normalizePath(context.getFilename()))) return
            if (!isThenChain(node.argument)) return
            context.report({
              node,
              message:
                'Do not fire and forget a Promise chain with void p.then(…); fork the work as an Effect in the owning scope (Effect.forkScoped / FiberMap).',
            })
          },
        }
      },
    },
    'effect-span-name-format': {
      create(context) {
        return {
          CallExpression(node) {
            if (!isOwnedEffectSource(context) || !isEffectCall(node, ['fn', 'withSpan'], context)) return
            const name = node.arguments
              .slice(0, 2)
              .map(staticString)
              .find(value => value !== undefined)
            if (name === undefined || spanNamePattern.test(name)) return
            context.report({
              node,
              message: `Span name '${name}' must read '<subject> <verb>': lowercase words separated by single spaces, for example 'jj run' or 'memory notes list'.`,
            })
          },
        }
      },
    },
    'no-effect-unstable-import': {
      create(context) {
        const check = (node, source) => {
          if (typeof source !== 'string' || !source.startsWith('effect/unstable/')) return
          context.report({
            node,
            message: 'effect/unstable/* does not exist in Effect 4.1; import from effect, effect/process, effect/http, effect/sql or effect/rpc.',
          })
        }
        return {
          ImportDeclaration(node) {
            check(node, node.source.value)
          },
          ExportNamedDeclaration(node) {
            check(node, node.source?.value)
          },
          ExportAllDeclaration(node) {
            check(node, node.source.value)
          },
          ImportExpression(node) {
            check(node, staticString(node.source))
          },
        }
      },
    },
  },
}

export default plugin

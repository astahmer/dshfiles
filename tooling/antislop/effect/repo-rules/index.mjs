const normalizePath = value => String(value).replaceAll('\\', '/')

const memberName = node => {
  if (node?.computed) return undefined
  return node?.property?.type === 'Identifier' ? node.property.name : undefined
}

const effectImports = context => {
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
}

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

const isEffectSource = context => {
  const filename = normalizePath(context.getFilename())
  const inEffectPaths =
    (filename.includes('/plugins/@dshfiles/') && filename.includes('/src/')) ||
    filename.includes('/tooling/dshx/packages/dshx/src/effect/') ||
    filename.includes('/tooling/antislop/effect/repo-rules/fixtures/')
  const importsEffect = /from\s*['"]effect['"]/u.test(context.sourceCode.text)
  return inEffectPaths && importsEffect && !/(?:\.test|\.spec|\.bench)\.[cm]?[jt]sx?$/u.test(filename)
}

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

const hostHandlersObject = (argument, sourceCode) => {
  if (argument?.type === 'ObjectExpression') return argument
  if (argument?.type !== 'Identifier') return undefined
  let handlers
  visit(sourceCode.ast, node => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.id.name === argument.name && node.init?.type === 'ObjectExpression') {
      handlers = node.init
    }
    return false
  })
  return handlers
}

const isHostHandler = (node, sourceCode) => {
  let current = node.parent
  while (current !== undefined && current !== null) {
    if (current.type === 'CallExpression' && isHostFactory(current) && current.arguments[1]?.start <= node.start && node.end <= current.arguments[1]?.end)
      return true
    current = current.parent
  }

  const name = enclosingFunctionName(node)
  let referenced = false
  visit(sourceCode.ast, child => {
    if (child.type !== 'CallExpression' || !isHostFactory(child)) return false
    const handlers = hostHandlersObject(child.arguments[1], sourceCode)
    if (handlers === undefined) return false
    if (handlers.start <= node.start && node.end <= handlers.end) referenced = true
    if (name !== undefined) {
      referenced ||= handlers.properties.some(property => property.type === 'Property' && property.value?.type === 'Identifier' && property.value.name === name)
    }
    return false
  })
  return referenced
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

const hasRootLayerFactory = (sourceCode, context) => {
  const imports = effectImports(context)
  return visit(sourceCode.ast, node => isMemberCall(node, 'Layer', new Set(['effect', 'scoped', 'sync', 'succeed']), imports))
}

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

const isRootLayerHelper = (node, sourceCode, context) => {
  const name = layerHelperName(node)
  if (name === undefined) return false
  const calls = []
  visit(sourceCode.ast, child => {
    if (child.type === 'CallExpression' && child.callee?.type === 'Identifier' && child.callee.name === name) calls.push(child)
    return false
  })
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
            if (!isEffectSource(context) || !isRun(node, context) || !isHostHandler(node, context.sourceCode)) return
            context.report({ node, message: 'A DshxEffect.host/hostApi handler must return its Effect; do not execute it with Effect.runPromise.' })
          },
        }
      },
    },
    'no-cordis-get-outside-root-layer': {
      create(context) {
        return {
          CallExpression(node) {
            if (!isEffectSource(context) || !hasRootLayerFactory(context.sourceCode, context) || node.callee?.type !== 'MemberExpression') return
            if (node.callee.object?.type !== 'Identifier' || node.callee.object.name !== 'ctx' || memberName(node.callee) !== 'get') return
            if (insideRootLayer(node, context) || isRootLayerHelper(node, context.sourceCode, context)) return
            context.report({
              node,
              message: 'Read Cordis ctx.get dependencies only in the root Layer factory; provide typed Effect services to the rest of the plugin.',
            })
          },
        }
      },
    },
  },
}

export default plugin

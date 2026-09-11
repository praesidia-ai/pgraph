# Follow local package calls to current source

The 0.5.2 preview fixes a missing-evidence problem in TypeScript projects: a caller
imports a local package through its public exports, but the graph cannot connect
it to the implementation because those exports point to generated declarations.
Without that edge, callers, impact and candidate test paths can all miss the same
dependency. This is useful independently of AI.

## Evidence and product decision

A read-only directory inventory of the maintainer's `frontier` workspace found
31 repositories, 5,120 `.ts` files, 60 `.tsx` files, 19 `.js` files and 528 `.cs`
files. TypeScript appeared in 22 repositories and C# in two. This inventory skipped
common output/dependency directories and did not apply PGraph's full discovery
rules; it is not an indexed-language coverage measure or a survey of other users.
The original sources and indexes were not modified by this inventory.

A separate synthetic local-package case reproduced the defect: an explicit
TypeScript project reference, a package export pointing at `dist/index.d.ts`, and
a `checkout()` function calling `chargeCard()`. Both source files were indexed,
but `callees(checkout)` was empty. The old/new
[worker comparison](../benchmarks/reports/v052-project-references.json) keeps fixture
contents fixed and checks callers, callees and candidate test paths. The baseline
is the retained 0.5.1 VSIX; the preview worker is fingerprinted in the report.

This fits a documented TypeScript workflow: referenced projects expose declaration
outputs, and declaration maps/source redirects support navigation back to source.
PGraph uses compiler configuration to resolve current indexed source; it does not
claim that a previously built artifact contains that same implementation.
[TypeScript project references](https://www.typescriptlang.org/docs/handbook/project-references.html),
[declaration maps](https://www.typescriptlang.org/tsconfig/declarationMap.html),
[source redirects](https://www.typescriptlang.org/tsconfig/disableSourceOfProjectReferenceRedirect.html)
(checked 10 September 2026).

## Supported behavior

Explicit `tsconfig` references establish the local projects eligible for source
resolution. Compiler output names map individual indexed source files to their
declared outputs. The TypeScript resolver still evaluates package exports,
subpaths, module modes and path aliases. Re-exports and method calls then use
the normal compiler symbol graph. A referenced source file's own compiler options
resolve its internal imports, and each file's graph is published by its owning
configuration.

This works before building a referenced package and with a local package link
whose generated declarations are stale. An actually installed separate package
takes precedence. PGraph reads local source through its existing secure reader;
it does not follow module links to read source or import/execute repository code.
Edges redirected from declared outputs carry `resolution: referenced project
source` metadata. Both ordinary compiler analysis and this source view remain
static evidence, not runtime dispatch or deployment verification.

Reference traversal is bounded to 128 configurations per compiler group. Outside-root
references, invalid/missing configs, duplicate package names and ambiguous bundled
outputs remain unresolved with bounded diagnostics. `outFile` bundles are not
mapped to guessed individual implementations. An unambiguous output mapping needs
`composite` or an explicit `rootDir`; arbitrary package-name similarity does not
establish an edge. Excluded and unindexed files remain outside the source graph.

This feature concerns local packages inside one indexed repository. It does not
turn imports from separately opened repositories or HTTP/messages between services
into proven cross-service impact paths.

## Upgrade and use

Install the 0.5.2 VSIX, then run **PGraph: Index Workspace** or **Index Repository**.
The CLI equivalent is `pgraph index --changed --root /absolute/repository`.
Extraction version 4 rebuilds an older graph once. Freshness reports expose
`extractionChanged`, and agent tools request reindexing instead of returning an
older extraction as though it included this fix. No database schema migration or
repository build is needed for this upgrade.

Use **Find Callers** or **Impact Analysis** on an exported function. Agents can use
the same `callers`, `callees`, `impact`, `tests` and `context` tools. In Workspace
scope, carry the returned project ID into follow-up queries as described in the
[workspace guide](WORKSPACE_GRAPH.md).

## What is still unproven

The controlled fixture establishes a missing graph connection and its downstream
retrieval paths. Its extra evidence costs more response tokens than the old empty
result; it is not a token-savings claim. Static candidate tests were not executed
by that probe, and no host model, paid tokens, task time or developer retention was
measured.

The self-repository retrieval diagnostics remain development evidence with inherited
oracles, not held-out task trials. Source and engine changes prevent treating
successive reports as a controlled ranking comparison. Broader natural-language
context selection, cross-service impact and real-workspace performance remain
[v2 delivery gates](V2_DELIVERY.md).

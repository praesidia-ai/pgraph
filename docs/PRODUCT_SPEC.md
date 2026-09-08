You are a principal engineer, staff-level architect, compiler/tooling engineer, VS Code extension engineer, AI agent infrastructure engineer, and open-source maintainer.

Your task is to design and implement a production-quality open-source project that creates a persistent, local, graph-native understanding of a software repository and exposes highly compressed, token-aware context to GitHub Copilot and other coding agents.

The project must NOT be designed merely as a GitHub Copilot extension.

The core product is an independent code-intelligence library and context engine.

GitHub Copilot inside Visual Studio Code is only the first consumer.

The long-term vision is:

Repository
→ deterministic code graph
→ semantic/concept graph
→ context optimization engine
→ Copilot / MCP / CLI / other coding agents

The primary goal is:

Reduce repository-context tokens consumed by coding agents by at least 50% on medium and large repositories without reducing task correctness.

Stretch goal:

60–80% context-token reduction for repository exploration, architecture understanding, impact analysis, debugging, and large multi-file changes.

The project should become an open-source:

"Graph-native context engine for coding agents."

A possible positioning statement is:

"Give coding agents the minimum code necessary to solve the task."

Do not blindly clone Graft.

Study the architectural principles behind tools such as Graft, Sourcegraph/SCIP, Tree-sitter, language servers, code graph systems, dependency analysis tools, and modern AI coding-agent context systems, but create a clean architecture optimized specifically for token-aware agent context retrieval.

The implementation must work well with GitHub Copilot in Visual Studio Code because the target company currently permits Copilot but does not permit external OpenAI, Anthropic, Gemini, Claude Code, Codex API keys, or arbitrary third-party LLM APIs.

The project must therefore work fully without any external LLM API key.

GitHub Copilot semantic enrichment may be added through supported Visual Studio Code Language Model APIs, but the deterministic code graph must work completely offline and without any AI provider.

==================================================

1. CORE PRODUCT PRINCIPLES
   ==================================================

The architecture must obey the following principles.

1. Local-first.

Source code and indexes remain on the developer's machine by default.

No cloud database is required.

No Docker dependency should be required for normal development use.

2. Deterministic first.

Most intelligence should come from deterministic analysis:

- AST parsing
- symbol definitions
- references
- imports
- exports
- calls
- callers
- implementations
- inheritance
- interfaces
- route relationships
- tests
- configuration relationships
- events
- database usage
- dependency relationships
- git metadata

AI is enrichment, not the foundation.

3. Symbol-first, not file-first.

Do not treat source files as the primary retrieval unit.

The primary retrieval unit should be symbols such as:

- modules
- classes
- interfaces
- types
- functions
- methods
- routes
- handlers
- tests
- database models
- events
- queues
- configuration keys

Agents should usually receive only relevant symbols or source ranges rather than entire files.

4. Graph-native.

Repository knowledge must be represented as nodes and typed edges.

5. Incremental.

Changing one file must not require a repository-wide rebuild.

6. Language-agnostic core.

The central graph representation must not depend on Tree-sitter, TypeScript compiler internals, or any single language.

7. Strict token awareness.

Context generation must accept an explicit token budget.

Example:

graph.context({
task: "Add account lockout after five failed login attempts",
maxTokens: 1800
})

The result must never unnecessarily dump large files.

8. Progressive disclosure.

Start with compact architecture/context.

Expand only if the agent needs additional detail.

9. Copilot-native, but not Copilot-dependent.

Visual Studio Code and Copilot are adapters.

The core should later work through:

- VS Code
- GitHub Copilot
- MCP
- CLI
- Claude
- Codex
- JetBrains
- custom agents
- CI systems

10. Security and privacy must be first-class.

Do not send source code to external services unless explicitly configured.

================================================== 2. INITIAL SCOPE
================

The first production MVP should focus on:

TypeScript
JavaScript
TSX
JSX

Support Node.js backend and React/Next.js repositories particularly well.

Do not prematurely implement ten languages.

However, design all internal interfaces so additional language adapters can later support:

- Python
- Java
- C#
- Go
- Rust
- PHP
- Kotlin

Use Tree-sitter where appropriate.

For TypeScript, use the TypeScript compiler API or language-service/type-checker information where it improves precision.

SCIP ingestion should be designed as an optional future or initial adapter for repositories that already have precise indexes.

================================================== 3. REPOSITORY STRUCTURE
=======================

Use a monorepo.

A recommended layout is:

pgraph/
apps/
vscode-extension/
playground/

packages/
graph-core/
graph-ir/
graph-store/
graph-store-sqlite/
graph-parser/
graph-parser-tree-sitter/
graph-typescript/
graph-indexer/
graph-query/
graph-context/
graph-ranking/
graph-semantic/
graph-git/
graph-mcp/
graph-cli/
graph-vscode/
graph-benchmark/
shared/

examples/
sample-typescript-app/
sample-nextjs-app/
sample-monorepo/

benchmarks/
docs/
scripts/
.github/

Choose pnpm, npm workspaces, Turborepo, or Nx based on architectural merit.

Avoid unnecessary complexity.

================================================== 4. GRAPH INTERMEDIATE REPRESENTATION
====================================

Create our own language-neutral Graph IR.

Do not expose Tree-sitter AST nodes as the storage model.

Example conceptual interfaces:

GraphNode {
id
kind
name
qualifiedName
language
location
signature
visibility
metadata
}

GraphEdge {
from
to
type
confidence
metadata
}

Node kinds should support at minimum:

repository
package
directory
file
module
namespace
class
interface
type
enum
function
method
constructor
property
variable
constant
route
controller
service
repository_class
database_model
database_table
test
event
event_handler
queue
queue_handler
configuration
feature
concept

Edge types should support at minimum:

CONTAINS
IMPORTS
EXPORTS
REFERENCES
CALLS
CALLED_BY
IMPLEMENTS
EXTENDS
RETURNS
ACCEPTS
READS
WRITES
TESTED_BY
ROUTED_FROM
DEPENDS_ON
CONFIGURED_BY
EMITS
CONSUMES
HANDLES
CREATES
UPDATES
DELETES
BELONGS_TO_FEATURE
BELONGS_TO_CONCEPT

Do not physically store redundant reverse edges such as both CALLS and CALLED_BY unless justified.

The query layer can derive reverse traversals.

IDs must be deterministic across reindexing where possible.

Example:

typescript:src/auth/auth.service.ts:AuthService.login

================================================== 5. STORAGE ENGINE
=================

For local use, use SQLite.

Target:

.pgraph/
graph.db
config.json
cache/
logs/

Do not require Neo4j.

Create a storage abstraction so alternative backends can be implemented later.

SQLite tables may include:

files
nodes
edges
concepts
symbol_concepts
index_runs
git_metadata
semantic_cache

Create appropriate indexes for:

node names
qualified names
file locations
edge source
edge destination
edge type
node kind
hash values

Use transactions.

Implement schema migrations.

Use WAL mode if appropriate.

Graph traversal performance must be benchmarked.

================================================== 6. INDEXING PIPELINE
====================

Implement a robust pipeline:

Repository discovery
→ ignore rules
→ file hashing
→ changed-file detection
→ language detection
→ parsing
→ symbol extraction
→ relation extraction
→ cross-file resolution
→ graph normalization
→ storage
→ optional semantic enrichment

Respect:

.gitignore
custom ignore config
node_modules exclusion
build artifacts
generated directories

Track content hashes.

If a file has not changed, do not reparse it unnecessarily.

When one file changes:

- remove/update obsolete symbols
- rebuild relationships involving that file
- update cross-file references where necessary
- preserve unaffected graph data

Provide commands:

pgraph init
pgraph index
pgraph index --changed
pgraph status
pgraph clean
pgraph rebuild

================================================== 7. TYPESCRIPT INTELLIGENCE
==========================

For TypeScript/JavaScript support, detect and model:

imports
exports
default exports
named exports
classes
interfaces
types
enums
functions
arrow functions
methods
constructors
properties
generics
decorators
function calls
method calls
inheritance
interface implementations
references
parameter types
return types
exceptions where discoverable
React components
React hooks
Next.js routes
NestJS controllers
NestJS providers
Express routes
database models
tests

Support monorepos.

Understand tsconfig path aliases.

Understand workspace/package relationships.

Where possible, use the TypeScript type checker to resolve symbols accurately across files rather than relying purely on text matching.

================================================== 8. FRAMEWORK-AWARE RELATIONSHIPS
================================

The initial implementation should recognize common application architecture patterns.

NestJS:

@Controller
@Get
@Post
@Put
@Patch
@Delete
@Injectable
@Module
@EventPattern
@MessagePattern
queues
guards
interceptors
middleware

Next.js:

App Router
Pages Router
route handlers
server actions
API routes
layouts
pages
components

React:

components
hooks
contexts
providers

Express/Fastify:

routes
handlers
middleware

Testing:

Jest
Vitest
Playwright

Database:

Prisma
TypeORM
Drizzle
Sequelize where practical

Do not overfit the core to these frameworks.

Create pluggable enrichers/adapters.

================================================== 9. SOURCE SLICES
================

Implement symbol-level source extraction.

API:

graph.slice("AuthService.login")

should return only the source range for the requested symbol.

Never force the consumer to load the whole file.

Also support:

graph.fileSlice({
file,
startLine,
endLine
})

Provide surrounding context options.

================================================== 10. CODE SKELETONS
==================

Implement compact skeleton generation.

Example original:

class BillingService {
// 1,200 lines
}

Skeleton:

class BillingService {
createInvoice(input: CreateInvoiceInput): Promise<Invoice>;
cancelInvoice(id: string): Promise<void>;
refundInvoice(id: string, amount: number): Promise<Refund>;
calculateTax(invoice: Invoice): TaxResult;
}

Skeletons should retain:

- signatures
- modifiers
- decorators when important
- base classes
- implemented interfaces
- relevant fields
- types

but remove implementation bodies.

Expose:

graph.skeleton(symbol)

graph.skeletonFile(file)

This is a major token optimization mechanism.

================================================== 11. HIGH-LEVEL QUERY API
========================

Provide a clean public API.

Examples:

graph.symbol("AuthService.login")

graph.searchSymbols("login")

graph.callers("AuthService.login")

graph.callees("AuthService.login")

graph.references("User")

graph.implementations("PaymentProvider")

graph.testsFor("BillingService.refund")

graph.dependencies("BillingService")

graph.dependents("BillingService")

graph.path(
"AuthController.login",
"TokenService.issue"
)

graph.impact("User.email")

graph.feature("authentication")

graph.architecture()

graph.slice("AuthService.login")

graph.skeleton("AuthService")

Do not make consumers write SQL.

================================================== 12. IMPACT ANALYSIS
===================

Implement a useful impact engine.

Example:

graph.impact("AuthService.login")

should return:

target
direct callers
indirect callers
routes
tests
dependent modules
affected public APIs
database effects
events
likely change surface

Allow depth:

graph.impact(symbol, {
depth: 1
})

graph.impact(symbol, {
depth: 3
})

Rank likely impact rather than returning thousands of unrelated nodes.

================================================== 13. CONTEXT ENGINE — THE MOST IMPORTANT FEATURE
===============================================

The most important public API is:

graph.context({
task,
maxTokens,
options
})

Example:

graph.context({
task: "Add retries when Stripe payment creation fails",
maxTokens: 2000
})

This function must produce the minimum sufficient repository context for an AI agent.

Pipeline:

task
→ candidate discovery
→ symbol matching
→ concept matching
→ graph expansion
→ relevance scoring
→ deduplication
→ skeleton selection
→ source-range selection
→ test selection
→ constraint selection
→ token-budget optimizer
→ compact context package

The output should include:

- probable entry points
- relevant symbols
- signatures
- compact architecture flow
- direct dependencies
- direct callers
- related tests
- likely change surface
- constraints
- source locations
- selected source snippets only when needed
- confidence scores where useful

Example output:

Feature: Authentication

Entry:
AuthController.login
src/auth/auth.controller.ts:42

Flow:
AuthController.login
→ AuthService.login
→ UserRepository.findByEmail
→ PasswordService.verify
→ TokenService.issue

Related:
AccountLockoutService.isLocked
AccountLockoutService.recordFailure

Tests:
auth.service.spec.ts
account-lockout.service.spec.ts

Likely change surface:
4 symbols
3 files

Token usage:
1,423 / 1,800

The engine must be able to generate output in:

JSON
Markdown
structured object form

================================================== 14. TOKEN BUDGET ENGINE
=======================

Do not implement token optimization as a simple character limit.

Create a real budget optimizer.

Possible priorities:

highest:
target symbols
entry points
exact signatures

high:
direct callers
direct callees
interfaces
constraints

medium:
tests
related helpers
architecture summaries

lower:
indirect dependencies
full source snippets

Support token budget tiers.

Example:

500 tokens:
high-level map only

1,500 tokens:
signatures + direct graph

3,000 tokens:
selected implementations

8,000 tokens:
expanded change surface

The optimizer must choose between:

summary
skeleton
signature
source slice

depending on relevance and available budget.

================================================== 15. RELEVANCE RANKING
=====================

Create a deterministic relevance scorer before using embeddings or AI.

Possible features:

symbol name match
file/path match
graph distance
call relationship
framework relationship
test relationship
git co-change frequency
import relationship
route proximity
same package
semantic concept match
recent modification
public API status

Example:

score =
taskMatch

- graphProximity
- architectureImportance
- testRelationship
- semanticSimilarity
- gitCoChange

Normalize scores.

Make weighting configurable and testable.

================================================== 16. GIT INTELLIGENCE
====================

Use Git metadata as an additional signal.

Track where useful:

last modified commit
authors
change frequency
files often changed together
symbols frequently changed together when derivable
recent hot areas

This can improve impact analysis and ranking.

Do not leak personally sensitive information unnecessarily.

================================================== 17. CONCEPT GRAPH / SEMANTIC LAYER
==================================

Create a separate semantic concept layer.

Examples:

authentication
authorization
billing
sessions
permissions
notifications
document-processing

Concepts connect to symbols.

Example:

Authentication
→ AuthController.login
→ AuthService.login
→ TokenService.issue
→ SessionService.create

The semantic layer must be optional.

The deterministic code graph must remain useful without it.

Semantic data should be cached.

================================================== 18. GITHUB COPILOT SEMANTIC ENRICHMENT
======================================

Because the initial company environment allows GitHub Copilot in Visual Studio Code, support optional semantic enrichment through VS Code's supported Language Model API.

Do not require:

OPENAI_API_KEY
ANTHROPIC_API_KEY
GEMINI_API_KEY

The VS Code extension may access Copilot-provided models through supported VS Code APIs and user authorization.

Use this only for:

module summaries
feature identification
concept extraction
domain terminology
business constraints
architecture descriptions
relationship classification where deterministic techniques are insufficient

Do NOT ask Copilot to rediscover deterministic information we already know.

For example:

BAD:
"Read this file and tell me all imported modules."

GOOD:
"Given this already-extracted graph and compact skeleton, identify its domain responsibility and business concepts."

Semantic enrichment inputs should themselves be token-efficient.

================================================== 19. PERSISTENT MEMORY
=====================

Implement repository-level persistent knowledge.

Do not make agents rediscover the same architectural relationships on every task.

Store useful knowledge such as:

feature summaries
architecture descriptions
domain concepts
known entry points
important constraints
previously generated module summaries

Invalidate or refresh memory when the underlying source changes.

Do not store transient hallucinated facts as authoritative graph relationships.

Semantic facts need provenance and confidence.

================================================== 20. PROVENANCE
==============

Every derived fact should know where it came from.

Example:

{
relation: "AuthService.login CALLS TokenService.issue",
source: "typescript-compiler",
confidence: 1.0
}

Semantic:

{
concept: "authentication",
symbol: "AuthService.login",
source: "copilot-semantic-enrichment",
confidence: 0.88,
sourceHash: "..."
}

Differentiate deterministic vs inferred information.

================================================== 21. VS CODE EXTENSION
=====================

Create a high-quality Visual Studio Code extension.

Commands:

PGraph: Initialize Repository
PGraph: Index Repository
PGraph: Reindex Changed Files
PGraph: Show Architecture
PGraph: Find Symbol
PGraph: Find Callers
PGraph: Find Callees
PGraph: Impact Analysis
PGraph: Find Relevant Context
PGraph: Build Semantic Index
PGraph: Show Token Savings
PGraph: Graph Status

Add a sidebar view.

Suggested sections:

Overview
Index health
Files
Symbols
Features
Concepts
Current task
Token savings
Recent indexing

================================================== 22. COPILOT AGENT TOOLS
=======================

Register VS Code agent tools so Copilot Agent Mode can call PGraph directly.

Tools should include:

pgraph_context

pgraph_symbol

pgraph_search

pgraph_callers

pgraph_callees

pgraph_dependencies

pgraph_impact

pgraph_tests

pgraph_slice

pgraph_skeleton

pgraph_path

pgraph_architecture

pgraph_feature

pgraph_status

Tool descriptions must strongly encourage efficient use.

For example:

pgraph_context:
"Retrieve compact task-specific repository context before manually searching or opening many files."

Tool output must be compact.

Do not return entire files by default.

================================================== 23. MCP SERVER
==============

Expose the same graph engine via MCP.

This ensures the project is not limited to VS Code.

MCP tools should mirror the core query APIs.

Examples:

context
symbol
search
callers
callees
impact
tests
slice
skeleton
path
architecture
feature

Keep MCP thin.

The graph-core library must contain the real logic.

================================================== 24. CLI
=======

Create a CLI.

Examples:

pgraph init

pgraph index

pgraph status

pgraph symbol AuthService.login

pgraph callers AuthService.login

pgraph callees AuthService.login

pgraph impact AuthService.login

pgraph path AuthController.login TokenService.issue

pgraph context "Add rate limiting to login"

pgraph context "Add rate limiting to login" --tokens 1500

pgraph architecture

pgraph feature authentication

pgraph benchmark

Support:

--json
--markdown
--tokens
--depth

================================================== 25. TOKEN MEASUREMENT
=====================

Token efficiency must be measurable.

Measure at minimum:

estimated raw context
actual graph context
tokens avoided
percentage reduction
full files avoided
source lines avoided
tool calls
cache hits

Do not claim visibility into hidden Copilot-internal tokens if we cannot observe them.

Market and report this specifically as:

"repository-context token reduction"

Example UI:

Current task

Raw context estimate: 9,420
Context supplied: 2,841
Tokens avoided: 6,579
Reduction: 69.8%

Files avoided: 7
Symbols supplied: 11

================================================== 26. BENCHMARK FRAMEWORK
=======================

This is mandatory.

We need evidence that the project improves agent efficiency.

Build repeatable benchmark scenarios.

Categories:

Find where code lives

Explain feature flow

Architecture question

Impact analysis

Bug investigation

Single-file change

Multi-file feature

Large monorepo task

Test discovery

Refactor

For every benchmark compare:

BASELINE:
traditional repository search/open workflow

PGRAPH:
graph.context + selective source

Measure:

repository tokens supplied
number of files opened
lines read
tool calls
task correctness
task completion
latency where measurable

Targets:

> =50% context-token reduction across medium/large-repo benchmark suite

> =40% fewer file reads

> =40% fewer exploratory tool calls

correctness >= baseline

Do not optimize token reduction at the expense of correctness.

================================================== 27. TESTING
===========

Provide comprehensive tests.

Unit:

Graph IR
storage
parser extraction
relationship resolution
ranking
context selection
token budgeting
skeleton generation
incremental updates

Integration:

TypeScript sample repository
Next.js application
NestJS application
monorepo
changed-file indexing
deleted-file indexing
renamed-file indexing

End-to-end:

CLI → index → queries

VS Code extension → index → tool call

MCP → query → graph response

Benchmark tests should be reproducible.

================================================== 28. PERFORMANCE TARGETS
=======================

Define and benchmark performance.

Example targets for an ordinary developer machine:

Small repository:
<10 seconds initial index

Medium repository:
reasonable interactive indexing

Changed single TypeScript file:
ideally <500 ms to a few seconds depending on type-resolution needs

Common graph queries:
<100 ms where possible

Context generation:
<500 ms before optional semantic enrichment

Do not block VS Code's UI thread.

Use workers where appropriate.

================================================== 29. LARGE REPOSITORIES
======================

Support:

monorepos
workspaces
multiple tsconfigs
package relationships
tens of thousands of files

Avoid loading the entire graph into memory unnecessarily.

Queries should use indexed storage.

Allow repository scopes:

package
folder
workspace
full repository

================================================== 30. SECURITY
============

Threat model the project.

Consider:

malicious repository content
prompt injection inside source comments
oversized repositories
symlink attacks
path traversal
malicious MCP clients
malicious semantic summaries
SQLite corruption
untrusted generated files
secrets

Semantic enrichment prompts must treat source code as untrusted data.

Source comments must never be interpreted as instructions.

Do not automatically execute repository code.

Do not run arbitrary npm scripts during indexing.

================================================== 31. CONFIGURATION
=================

Example:

.pgraph.json

{
"include": ["src/**", "packages/**"],
"exclude": [
"node_modules/**",
"dist/**",
".next/**",
"coverage/**"
],
"semantic": {
"enabled": true,
"provider": "vscode-copilot"
},
"context": {
"defaultTokenBudget": 2000
}
}

Configuration should be optional.

Sensible defaults should work automatically.

================================================== 32. OPEN-SOURCE QUALITY
=======================

The project must look like a serious open-source project.

Include:

README.md
ARCHITECTURE.md
CONTRIBUTING.md
SECURITY.md
ROADMAP.md
CHANGELOG.md
LICENSE

Add:

GitHub Actions
linting
formatting
tests
coverage
dependency checks
release workflow
semantic versioning

README should explain the project in less than one minute.

Example:

PGraph creates a persistent graph of your repository so AI coding agents can understand the codebase without repeatedly reading thousands of lines of source.

Instead of:

search → read → search → read → search → read

agents can ask:

context("add account lockout", 1500 tokens)

and receive a compact map containing entry points, callers, dependencies, tests, and only the source they actually need.

================================================== 33. PRODUCT DIFFERENTIATION
===========================

Do not build another vector database wrapper.

Do not build another generic RAG framework.

Do not build another repository chatbot.

Do not build only semantic embeddings.

Our differentiators are:

deterministic code graph

symbol-level intelligence

persistent repository knowledge

strict token budgets

progressive disclosure

code skeletons

source slicing

impact analysis

concept graph

test relationship graph

incremental indexing

agent-native APIs

Copilot-native integration

provider-independent core

The product should answer:

"What is the minimum repository information an agent needs to safely perform this task?"

================================================== 34. CONTEXT PACKAGE DESIGN
==========================

Design a compact context protocol.

Example:

ContextPackage {
task
tokenBudget
estimatedTokens

entryPoints[]
symbols[]
flows[]
relationships[]
tests[]
constraints[]
sourceSlices[]
skeletons[]
concepts[]
likelyChangeSurface[]
}

Do not create verbose prose where structured representation is cheaper.

Example:

AUTH FLOW

AuthController.login
→ AuthService.login
→ UserRepository.findByEmail
→ PasswordService.verify
→ TokenService.issue

is preferable to 600 words explaining the same relationship.

================================================== 35. ADAPTIVE CONTEXT
====================

Different tasks need different graph views.

Example:

"Where is JWT generated?"

prioritize:
definitions
call paths
routes

"Change User.email type"

prioritize:
references
database models
API DTOs
tests
migration impact

"Why does login fail?"

prioritize:
control flow
exceptions
dependencies
logs/tests

"Add rate limiting"

prioritize:
entry points
middleware
existing security helpers
tests

Build a task classifier or retrieval strategy abstraction.

Do not require an LLM for basic classification.

================================================== 36. CACHE DESIGN
================

Cache:

parsing
symbol extraction
semantic summaries
skeletons
concept mappings
context computations when safe

Invalidate based on content hashes and relevant dependency changes.

Avoid stale semantic summaries.

================================================== 37. OBSERVABILITY
=================

Support opt-in diagnostic logging.

Track:

index duration
files parsed
files skipped
nodes created
edges created
query latency
context latency
context size
token estimates
cache hit ratios

Never send telemetry externally without explicit user consent.

================================================== 38. DEVELOPMENT EXECUTION
=========================

Do not only create an architecture document.

Actually implement the project.

Work iteratively.

Phase 1:
repository scaffolding

Phase 2:
Graph IR

Phase 3:
SQLite storage

Phase 4:
TypeScript parser/indexer

Phase 5:
symbol and relationship queries

Phase 6:
incremental indexing

Phase 7:
skeleton/source slicing

Phase 8:
impact engine

Phase 9:
context ranking + token budget engine

Phase 10:
CLI

Phase 11:
VS Code extension

Phase 12:
Copilot agent tools

Phase 13:
semantic Copilot enrichment

Phase 14:
MCP

Phase 15:
benchmark suite

Phase 16:
hardening, docs, releases

At the end of every phase:

run tests
run lint
run typecheck
verify no regression
document decisions

================================================== 39. CODE QUALITY RULES
======================

Use strict TypeScript.

Avoid any unless clearly justified.

Prefer small modules with clear responsibility.

No 2,000-line god services.

No placeholder TODO architecture.

No fake implementations.

No mocked production functionality.

Do not leave critical paths unfinished.

Avoid premature abstraction, but preserve adapter boundaries.

Every major package needs public interfaces and tests.

================================================== 40. AUTOMATIC VALIDATION
========================

Use the terminal continuously.

Run the actual application.

Run the CLI.

Run sample repositories.

If browser/UI capabilities are available, launch VS Code-compatible development environments or extension-host tests where practical.

Do not assume UI works because TypeScript compiles.

Test actual user workflows.

================================================== 41. FIRST USER EXPERIENCE
=========================

Target:

Install extension.

Open repository.

Click:

"Index repository"

or run:

pgraph index

Then ask Copilot:

"Add rate limiting to the login endpoint."

Copilot should automatically use:

pgraph_context

instead of opening 20 files.

The user should not need to understand graph theory.

================================================== 42. FUTURE ARCHITECTURE
=======================

Prepare extension points for:

SCIP
LSP-based indexers
other languages
remote shared team indexes
PostgreSQL
Neo4j export
embeddings
CI pre-indexing
pull-request impact analysis
GitHub application
JetBrains
Copilot CLI
Codex
Claude
distributed monorepo indexing

Do not implement all of these in MVP.

================================================== 43. POSSIBLE FUTURE TEAM MODE
=============================

Design the local model so we could eventually support shared organization knowledge.

Potential future:

repository graph built in CI
→ sanitized graph artifact
→ developers consume graph
→ local source slices remain local

Do not build a central source-code database in MVP.

================================================== 44. README DEMONSTRATION
========================

Provide a clear before/after example.

BEFORE:

Task:
"Add account lockout to login."

Agent reads:

auth.controller.ts
auth.service.ts
user.repository.ts
token.service.ts
security.service.ts
auth.service.spec.ts
other unrelated files

Repository context:
~18,000 tokens

AFTER:

pgraph_context({
task: "Add account lockout to login",
maxTokens: 1800
})

Returns:

AuthController.login
→ AuthService.login
→ UserRepository.findByEmail
→ PasswordService.verify

Existing:
AccountLockoutService

Tests:
auth.service.spec.ts
account-lockout.service.spec.ts

Relevant source slices:
3

Context:
~1,600 tokens

Then the agent opens only the required implementation ranges.

================================================== 45. IMPORTANT PRODUCT KPI
=========================

Treat the following as top-level product metrics:

Context token reduction
Correctness
Files avoided
Lines avoided
Exploratory tool calls avoided
Context generation latency
Graph freshness

The primary KPI should initially be:

"At least 50% reduction in repository-context tokens across representative medium and large repository coding tasks, with correctness equal to or better than baseline."

================================================== 46. DO NOT DO THESE THINGS
==========================

Do NOT:

require external LLM keys

depend entirely on embeddings

store only file chunks

return entire files by default

make Neo4j mandatory

require Docker

hardcode Copilot into graph-core

reindex the whole repository after every edit

send code to a cloud server by default

allow source comments to prompt-inject semantic analysis

generate giant verbose context dumps

optimize only for demos

claim token savings without benchmarks

confuse repository-context savings with all hidden model tokens

create meaningless abstraction layers

stop after scaffolding

================================================== 47. FIRST MILESTONE
===================

The first meaningful milestone must work end-to-end.

Given a TypeScript repository:

pgraph index

must build:

.pgraph/graph.db

Then:

pgraph symbol AuthService.login

must work.

Then:

pgraph callers AuthService.login

must work.

Then:

pgraph impact AuthService.login

must work.

Then:

pgraph context "Add account lockout to login" --tokens 1500

must return a ranked, compact context package within the requested budget.

Only after this works should the VS Code UI become the focus.

================================================== 48. BENCHMARK BEFORE CLAIMING SUCCESS
=====================================

Create several realistic sample tasks.

For each task record:

baseline files opened
baseline source lines
baseline estimated repository tokens

PGraph files/symbols
PGraph source lines
PGraph context tokens

Example result:

Task:
Add rate limiting to login

Baseline:
12 files
2,890 lines
18,230 context tokens

PGraph:
4 files
211 source lines
4,930 context tokens

Reduction:
72.9%

Correctness:
pass

The benchmark must be automated where practical.

================================================== 49. FINAL DEFINITION OF DONE
============================

The MVP is complete only when:

A real TypeScript repository can be indexed.

The graph persists locally.

Incremental reindexing works.

Symbols resolve across files.

Caller/callee relationships work.

Impact analysis works.

Source slices work.

Skeletons work.

Context generation works.

Token budgets are enforced.

CLI works.

VS Code extension works.

Copilot can invoke PGraph tools.

No external LLM API key is required.

Optional Copilot semantic enrichment works through supported VS Code mechanisms.

MCP works.

Benchmarks exist.

Token savings are measured.

Tests pass.

Documentation is usable.

The architecture remains provider-independent.

================================================== 50. WORKING STYLE
=================

Do not ask me repeatedly what to implement next.

Make sensible engineering decisions and proceed.

When a decision is uncertain:

research it
compare options
document the tradeoff
choose the best long-term architecture
continue

Do not simplify away core functionality merely to finish faster.

Do not leave me with only boilerplate.

Inspect every package you create.

Continuously validate compilation, tests, runtime behavior, CLI behavior, extension behavior, persistence, and incremental updates.

Act like this project will eventually be used by thousands of developers and enterprise engineering teams.

The result should feel like an actual developer infrastructure product, not an AI demo.

Start by:

1. inspecting the working directory,
2. deciding whether an existing project should be reused or a new monorepo initialized,
3. writing ARCHITECTURE.md,
4. defining Graph IR,
5. implementing SQLite persistence,
6. implementing the TypeScript indexer,
7. implementing symbol/caller/callee queries,
8. implementing context(task, tokenBudget),
9. creating benchmark fixtures,
10. proving the first token-reduction result.

Then continue toward the complete MVP.

# PGraph by Praesidia

<img src="docs/brand/pgraph-mark.png" alt="PGraph connected p monogram" width="160" />

**Local code context for TypeScript developers and coding agents.**

PGraph builds a persistent local graph of your repository. Agents retrieve
symbols, callers, dependencies, tests, signatures and selected source ranges with
an explicit token budget, instead of repeatedly opening whole files.

The engine is an independent TypeScript library. CLI, MCP, and VS Code/Copilot are
adapters. Indexing needs **no AI account, external API key, cloud database, or Docker**.

Start with a real error, unfamiliar symbol or working change. The
[first-use guide](docs/FIRST_VALUE.md) takes you from installing the preview to
source evidence and an applicable check, with separate paths for developers and
agents. The [user-gap research](docs/USER_GAP_RESEARCH.md) explains the problems,
existing alternatives and remaining validation needed before broader adoption.

## V2 preview: a daily workflow for understanding and checking changes

The **0.6.0 preview** adds **Workspace Impact for Current Symbol**. It follows
supported HTTP/Azure communication sites to handlers and candidate tests in other
open projects, retaining source hashes, ambiguous candidates and project failures.
The existing agent impact tool supports the same workspace query. See the
[reproduction, usage and limits](docs/WORKSPACE_IMPACT.md). No AI is required.

The **0.5.5 preview** keeps removed APIs reachable when a review contains many
changes. It prioritizes changes before output limits, reports scoped counts and
adds **Continue Historical Review** for pages tied to the same snapshot. Agents
use the existing workflow tool. [The paired reproduction](docs/HISTORICAL_REVIEW_PAGING.md)
documents missing evidence in 0.5.4 and the new continuation behavior.

The **0.5.4 preview** adds **Review Historical Impact**: compare working, staged or
committed declarations with their Git baseline, including old consumers of deleted
APIs and candidate test paths. Project and Workspace scopes retain separate Git
histories. [The evidence and limits](docs/HISTORICAL_IMPACT.md) distinguish declared
signature changes from compatibility checks. No model is required.

The **0.5.3 preview** improves local task selection: declaration filtering before
search limits, English inflections, term coverage and more selective graph traversal.
The [controlled selection investigation](docs/SELECTION_QUALITY.md) records better
target recall on a frozen development corpus and the substantial remaining gaps.
No query-time model call is required.

The **0.5.2 preview** fixes missing callers, callees and candidate test paths across
local TypeScript project references. Public package exports can resolve to current
indexed source before a build, including re-exports and class methods. Reindex
after upgrading. See [the source-resolution evidence and limits](docs/PROJECT_SOURCE_RESOLUTION.md).

The **0.5.1 preview** adds Project and Workspace scopes, including discovery of
direct child repositories when opening a parent folder. Run **PGraph: Choose
Scope**, then **Index Workspace** to build separate project indexes. Daily queries
group results and errors by project; a parent without `.git` is no longer used as
the Git baseline for all its children. See [workspace behavior and limits](docs/WORKSPACE_GRAPH.md).

Workspace task context now uses one output budget and retains each project's
identity, revision and source hashes. Agents can use the returned project IDs to
read additional source from the correct repository. Failed/stale projects remain
visible alongside successful evidence. The 0.6.0 impact command adds bounded static
paths; runtime delivery and contract compatibility remain open.

The **0.4.0 preview** adds eleven daily capabilities: live freshness checks, exact
source search, stack-frame lookup, file consumers, dependency cycles, changed
declaration mapping, staged/branch comparisons, test-gap candidates, package-check
discovery, recorded check execution and saved investigations. Open **PGraph: Daily
Workflow** from the status bar or command palette. See [the workflow guide](docs/DAILY_WORKFLOWS.md)
and [the cited product research](docs/DAILY_DEVELOPER_RESEARCH.md).

Version 0.2.0 adds **Context for Current Symbol** and **Review My Changes** in VS Code.
The first anchors a task to the cursor; the second refreshes the selected index and
shows conservative affected code, candidate tests and suggested checks for current
Git changes. It does not execute tests or reconstruct deleted-symbol history.

The **0.3.0 preview** adds query/cursor-targeted source excerpts, explained test
paths through declared interface members, context receipts for retained evidence,
selection diagnostics and dependency-lockfile invalidation. These all work without
AI. See the [agent workflow, compatibility notes and measured tradeoffs](docs/AGENT_CONTEXT.md).

Retrieval searches documentation, identifiers and error text with weighted local
FTS ranking. Context returns symbol IDs, selection reasons and short implementations
within the requested budget. **PGraph: Evidence Mode** defaults to `local`, which
excludes cached AI facts. `assisted` explicitly includes existing inferred evidence;
neither mode invokes a model. Semantic generation remains a separate explicit action.

This is a preview with [explicit remaining v2 release gates](docs/V2_DELIVERY.md).
After upgrading, run **PGraph: Index Repository** to migrate and refresh the index.

## Workspace relationship explorer

Run **PGraph: Index Workspace**, then **PGraph: Explore Relationships** to view
services across all folders in the current VS Code workspace. Drill into symbols,
filter directed relationships, inspect evidence and open source. HTTP, Azure queue
and Event Grid candidates use explicit URL/resource mappings; unknown targets stay
unresolved. See [setup and supported patterns](docs/WORKSPACE_GRAPH.md).

## Build from source

Requires Node.js **22.18+** (24 LTS recommended) and npm.

```sh
npm ci --ignore-scripts
npm run build

node packages/graph-cli/dist/main.js index --root examples/sample-typescript-app
node packages/graph-cli/dist/main.js symbol AuthService.login --root examples/sample-typescript-app
node packages/graph-cli/dist/main.js callers AuthService.login --root examples/sample-typescript-app
node packages/graph-cli/dist/main.js impact AuthService.login --root examples/sample-typescript-app
node packages/graph-cli/dist/main.js context "Add account lockout to login" \
  --tokens 1500 --root examples/sample-typescript-app
```

For your repository, replace the `--root` value. Indexes stay in its `.pgraph/`
directory. Add `.pgraph/` to that repository's `.gitignore` before committing.
PGraph does not edit agent instructions or install hooks. Indexing and query tools
run no repository scripts. The explicit **Run Repository Check** editor command
executes a selected package script through VS Code tasks.

The workspace also exposes `./node_modules/.bin/pgraph` after building.
Packages are prepared for publishing; this checkout does not assume they already
exist on npm or the VS Code Marketplace.

## Before and after

For the included account-lockout task, the declared baseline opens eight files:
controller, authentication, user repository, passwords, tokens, lockout and two tests.
PGraph returns a compact map such as:

```text
AuthController.login → AuthService.login
AuthService.login → UserRepository.findByEmail
AuthService.login → PasswordService.verify
AuthService.login → TokenService.issue

Existing: AccountLockoutService.isLocked / recordFailure
Tests: login rejects unknown accounts / lockout expires after fifteen minutes
```

Every selected symbol has a location. Request `slice` when implementation detail is
needed; request `skeleton` for signatures without method bodies.

**Measurement, not a marketing promise:** checked-in benchmark reports compare BPE
repository-context tokens against declared file-open traces. They also report
required-symbol recall. Coding-task correctness is explicitly **unevaluated**.
See [benchmark methodology and results](docs/benchmarks.md); the 50% product KPI
requires representative paired agent trials and remains a release gate.

## Library

```ts
import { PGraph } from "@praesidia/pgraph-core";

const graph = PGraph.open("/absolute/repository");
try {
  graph.index(); // hashes files; extracts only changed/affected files
  const result = graph.context({
    task: "Add account lockout to login",
    maxTokens: 1500,
    options: { format: "markdown", scope: "src" },
  });
  console.log(result.text); // complete serialized output <= requested BPE budget
  console.log(result.metrics); // separate measurement envelope
  console.log(graph.slice("AuthService.login"));
} finally {
  graph.close();
}
```

`result.package` is the structured protocol; `result.text` is its budgeted JSON or
Markdown serialization. Metrics are separate so adapters can report them without
silently spending the context budget. The default tokenizer is `cl100k_base` BPE,
an estimate for other model tokenizers. The VS Code tool adapter additionally honors
the host model's token counter when supplied. Hidden Copilot tokens are not visible.

## VS Code and Copilot

Build a local installable extension:

```sh
npm run package:extension
```

Install `artifacts/pgraph-0.6.0.vsix` using **Extensions → Install from VSIX**.
Open a trusted repository and run **PGraph: Index Repository**. For multiple
microservices, open their parent folder or add their folders to one VS Code workspace
and run **PGraph: Index Workspace** to index every detected project. Use the PGraph sidebar or enable its tools
in Copilot Agent Mode. `#pgraph_context` explicitly
requests compact context; tool descriptions encourage agents to use it first.
Automatic selection is ultimately the agent's decision.

The editor runs indexing in a separate Node process. If Node is not on PATH, set
the machine setting `pgraph.nodePath` to a Node 22.18+ executable.

If VS Code reports `spawn node ENOENT`, run `node --version` and
`node -p "process.execPath"` in Terminal **on the affected computer**. Set
**PGraph: Node Path** in VS Code user settings to that full executable path,
without added quotes, and retry indexing. Node must be 22.18+; installing the VSIX
does not install Node. Paths from a different laptop may not exist on this one.

For large repositories, indexing has a 15-minute execution limit. Adjust
`pgraph.indexTimeoutSeconds` in VS Code settings if needed. Query execution defaults
to 120 seconds (`pgraph.queryTimeoutSeconds`), excluding time queued behind an
index. The indexing notification names the current TypeScript configuration and
shows elapsed time; the PGraph output channel records stage messages. Workspace
indexing processes folders sequentially and releases idle workers between folders.
Each folder retains its own `.pgraph` database. Current query tools use one selected
folder. The [workspace explorer](docs/WORKSPACE_GRAPH.md) composes cross-service
communication candidates across those indexes; cross-root context packing remains
in [the v2 design](docs/V2_PLAN.md).

Semantic enrichment is optional: enable the **user/machine** setting
`pgraph.semanticEnabled`, then run **PGraph: Build Semantic Index** and select
a symbol and an available Copilot model. This sends compact source-derived evidence
through VS Code's consent-controlled Language Model API. It never runs automatically.
Live model availability and organization policy must be verified in your environment.
See [the integration guide](docs/integrations.md).

## MCP

Index first, then configure your client to launch the fixed-root stdio server:

```json
{
  "servers": {
    "pgraph": {
      "command": "node",
      "args": [
        "/absolute/pgraph/packages/graph-mcp/dist/main.js",
        "/absolute/repository",
        "--tool-profile",
        "essential"
      ]
    }
  }
}
```

Client configuration envelopes differ; the command and arguments are portable.
The optional `essential` profile exposes six investigation tools. Omit the profile
option for all 21 tools. See [profile tradeoffs and measurements](docs/integrations.md#mcp).
The server exposes query tools only. Its process has access to the chosen repository;
configure it only for clients you authorize to read that code.

## What works and where precision ends

- TS/JS/TSX/JSX declarations, compiler-resolved imports/re-exports/calls, inheritance,
  interfaces, typed references, parameter/return types and property access.
- Persistent SQLite, transactional incremental updates, deleted/renamed files,
  nested ignore rules, path aliases and multiple tsconfigs/workspace packages.
- Symbol queries, bounded paths/impact, slices, skeletons, configurable deterministic
  ranking and representation selection under a real BPE budget.
- Heuristics for Next App/Pages Router, React components/hooks/contexts, Nest
  controllers/providers/decorated handlers, Express-style routes, ORM/database
  operations, events, queues and tests. See [coverage details](docs/coverage.md).
- Hash-invalidated semantic memory with provenance; opt-in Git frequency/co-change
  metadata; no background telemetry.

Dynamic dispatch, reflection, runtime dependency injection, computed routes and
external library internals cannot be fully resolved statically. Cold incremental
processes may parse dependency ASTs for the checker even when only affected files
are re-extracted. Additional languages, Tree-sitter and SCIP ingestion are future
adapters, not claimed features.

## Develop

```sh
npm run check          # typecheck, lint, tests
npm run test:coverage
npm run format:check
npm run test:extension # actual VS Code extension host
npm run benchmark     # local self-repository retrieval scenarios
npm run benchmark:scale -- 1000
```

Read [ARCHITECTURE.md](ARCHITECTURE.md), [CONTRIBUTING.md](CONTRIBUTING.md),
[SECURITY.md](SECURITY.md), [API/configuration](docs/api.md), and [ROADMAP.md](ROADMAP.md).
Licensed under [MIT](LICENSE).

## Project identity

The command is `pgraph`, the public class is `PGraph`, packages use
`@praesidia/pgraph-*`, and Copilot tools use the `pgraph_` prefix. Repository
settings live in `.pgraph.json`; indexes live in `.pgraph/`. Run `pgraph index`
to create or update the index.

Install `artifacts/pgraph-0.6.0.vsix` to use the `praesidia.pgraph` extension.
Editor settings use `pgraph.*`. Package and Marketplace publishing remains a
separate release step.

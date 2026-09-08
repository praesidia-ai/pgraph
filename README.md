# PGraph by Praesidia

<img src="docs/brand/pgraph-mark.png" alt="PGraph connected p monogram" width="160" />

**Give coding agents the minimum code necessary to solve the task.**

PGraph builds a persistent local graph of your repository. Agents retrieve
symbols, callers, dependencies, tests, signatures and selected source ranges with
an explicit token budget, instead of repeatedly opening whole files.

The engine is an independent TypeScript library. CLI, MCP, and VS Code/Copilot are
adapters. Indexing needs **no AI account, external API key, cloud database, or Docker**.

## Try it in one minute

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
PGraph does not edit agent instructions, install hooks, or run repository scripts.

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

Install `artifacts/pgraph-0.1.0.vsix` using **Extensions → Install from VSIX**.
Open a trusted repository and run **PGraph: Index Repository**. Use the PGraph
sidebar or enable its tools in Copilot Agent Mode. `#pgraph_context` explicitly
requests compact context; tool descriptions encourage agents to use it first.
Automatic selection is ultimately the agent's decision.

The editor runs indexing in a separate Node process. If Node is not on PATH, set
the machine setting `pgraph.nodePath` to a Node 22.18+ executable.

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
        "/absolute/repository"
      ]
    }
  }
}
```

Client configuration envelopes differ; the command and arguments are portable.
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

Install `artifacts/pgraph-0.1.0.vsix` to use the `praesidia.pgraph` extension.
Editor settings use `pgraph.*`. Package and Marketplace publishing remains a
separate release step.

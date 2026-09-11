# PGraph intelligence without AI, and with an AI agent

Design investigation, 2026-09-09. Complements the
[developer delivery investigation](DEVELOPER_DELIVERY_INVESTIGATION.md).
This is a proposed design, not a claim that these capabilities are implemented.
It records the pre-implementation investigation. Some early capabilities are now
in the 0.2.0 preview; consult [V2_DELIVERY.md](V2_DELIVERY.md) for current status.

**Build the intelligence into the local analysis engine. Let an optional AI agent
use that engine to investigate, plan, change and verify code.** A useful no-AI
product should remain available even if every model integration is disabled.

## Three modes with one core

| Mode                                            | PGraph uses a model?                                              | Developer experience                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Local analysis                                  | No model calls, embeddings or model-derived facts                 | Search, flows, change impact, contract checks, related tests and structured explanations |
| Local analysis used by an existing coding agent | PGraph itself makes no model calls; the host agent uses its model | The agent uses PGraph evidence to investigate and implement the task                     |
| Optional model-assisted analysis                | Explicit, bounded model calls in an adapter                       | Ambiguous intent, candidate explanations and plans, checked against local evidence       |

The second mode should be the default AI integration. PGraph already exposes local
queries through [MCP](../packages/graph-mcp/src/index.ts) and
[VS Code tools](../apps/vscode-extension/src/extension.ts). The host agent can reason
over those results. It does not require PGraph to start a second model conversation.
This division follows the [VS Code tool-calling model](https://code.visualstudio.com/api/extension-guides/ai/tools),
where the model selects a tool and supplies arguments and the extension executes it.

“No model calls” and “no model-derived evidence” need separate controls. Currently
the enrichment setting controls explicit model use, but
[ContextEngine](../packages/graph-context/src/index.ts) reads semantic facts when
seeding candidates and adding constraints, and `GraphQuery.feature` also consults
them. A strict local mode should exclude cached semantic facts at every query path,
include the evidence policy in cache keys, and test the transition after enrichment.
Existing facts can remain stored for an explicitly selected assisted mode.

## What smart means without AI

The engine should answer concrete questions by joining source facts and applying
explicit algorithms. TypeScript semantic analysis means resolving program meaning
through compiler rules; it does not imply an AI model.

### 1. Find the right code using several independent signals

Keep the current FTS index, but use a richer schema: identifiers, path, signature,
documentation, test descriptions, exception messages, routes, events and configuration
keys as separately weighted fields. Preserve source locations for every indexed text
fragment. Add exact paths, stack frames, active selections and changed symbols as
high-priority anchors. Use a small, editable team glossary for domain aliases.

PGraph already orders FTS matches by `rank`, which uses BM25 by default. The missing
improvement is not simply “add BM25”: search currently merges evidence into one text
field, queries individual terms, and then applies mostly substring/proximity scoring.
Use phrase/multi-term retrieval, field weights and rank fusion with graph distance,
while protecting exact anchors. [SQLite FTS5](https://www.sqlite.org/fts5.html)
supports weighted BM25, phrase queries and proximity queries without a model.

Bound expansion, penalize generic high-degree helpers, retain package diversity when
scope is unknown, and return an explicit ambiguity when several targets remain.
Provide structured task actions such as “impact of this change” so the developer
does not have to express everything as natural language.

This will not resolve every paraphrase or infer undocumented business concepts.
The no-AI interaction can request an anchor or offer ranked alternatives. Evaluate
against new tasks; extending the glossary solely to pass the earlier ten prompts
would overfit the diagnostic.

### 2. Describe behavior using flow and effect analysis

Current extraction records calls, property reads/writes, some database/event effects
and exception text. It does not model general value propagation or branch conditions.
Extend it incrementally with function summaries: parameters consumed, values returned,
conditions before supported effects, possible throws, writes and emissions.

Start inside a function: assignments, object-field copies, returns and simple guards.
Then compose bounded summaries across known calls, explicitly reporting unresolved
dispatch, aliasing, async callbacks and external functions. In cycles, use bounded
fixed-point computation and expose widening/limit exhaustion. Do not turn “no local
write found” into “this call has no side effects.”

This enables specific questions such as “Which handlers read this message field?”
and “Which local branch reaches this error?” [CodeQL's data-flow documentation](https://codeql.github.com/docs/writing-codeql-queries/about-data-flow-analysis/)
explains the distinction between local and global value-flow analysis and the extra
cost and modeling challenges of the latter. That is an architectural reference;
installing CodeQL is not a requirement of this proposal.

For the first release, deliver a few supported analyses well. A general-purpose
whole-program analyzer would be a much larger project and should not block the
change workflow.

### 3. Analyze the change, including its contracts

Build a versioned change set from diff hunks and before/after symbols. Compare public
signatures, exported types, routes, supported payload schemas and configuration.
Traverse evidenced consumers and carry a reason for each affected result.

Compatibility rules must account for direction. Requiring a new field in a request
can invalidate older callers; emitting an additional response field is not inherently
breaking. TypeScript assignability alone does not establish runtime wire compatibility,
particularly with validators, defaults and serialization.

Start with named supported schema forms and rules, plus compiler diagnostics for
affected projects. The current extractor uses the checker for symbol resolution but
records syntax/configuration diagnostics; an index with zero diagnostics does not
mean a project passed a full typecheck. Use an explicit verification action for the
full compiler checks. Removed symbols need baseline evidence, and unsupported changes
remain unknown.

The existing workspace topology can connect service endpoints. Add links from those
endpoints to payload definitions and handler parameters before attempting field-level
cross-service impact.

### 4. Find omissions using explicit rules and historical evidence

Examples of deterministic rules include a changed producer field still read under
its old name by a resolved consumer, a new required parameter omitted at a known
call site, or an import that violates a developer-authored package-boundary rule.
Report the rule, relevant source and scope of analysis.

Historical co-change and repeated repository patterns can suggest companion work:
“Changes here frequently include this integration test.” Normalize by frequency,
require enough observations, and discount bulk commits. A common pattern is a
heuristic, not a project requirement. Developers may promote a reviewed convention
to an explicit rule. The existing Git module already collects co-change information.

### 5. Select checks and remember what they verified

Combine changed symbols with direct/indirect test dependencies and optional imported
coverage. Rank tests by affected behavior and execution cost; selection can use a
greedy coverage algorithm, but it is only as complete as the dependency evidence.
Use wider package checks when that evidence is weak, and retain required CI checks.

Run supported test/compiler commands through an explicit editor action and associate
each result with source, configuration and tool versions. On an edit, invalidate the
affected result. “Passed these checks for this revision” is a useful claim; “the change
is correct” needs more evidence than a green subset of tests.

## A concrete example already present in the repository

The [authentication fixture](../examples/sample-typescript-app/src/auth.service.ts)
looks up the user, checks disabled status and the password, then throws an error or
issues a token. A separate
[AccountLockoutService](../examples/sample-typescript-app/src/account-lockout.service.ts)
has methods for checking lockout, recording failure and clearing it. The current
login method does not directly call that helper.

For a task anchored to login, an improved no-AI engine could present:

```text
Current flow: user lookup → rejection checks → token creation
Relevant existing helper: AccountLockoutService
Direct integration: no call from AuthService.login to that helper
Lockout condition in helper: count >= 5 and elapsed < 900,000 ms
Related test: login rejects unknown accounts
Next actions: open helper, inspect callers, review a diff, select checks
```

Those statements can come from source extraction, simple expression interpretation,
graph queries and templates. Recognizing the guard expression is a proposed analysis;
the existing graph alone does not already produce that complete explanation.
The engine should not invent the desired behavior for successful logins or unknown
accounts. Those decisions need supplied requirements or an explicit project rule.

## What the AI-assisted experience must add

The current per-symbol enrichment produces summaries, concepts, constraints and a
model confidence value. Its parser checks JSON shape and provenance freshness, not
the factual truth of those claims. This is useful tagging, but it does not meet a
high bar for an intelligent coding workflow.

A stronger agent should follow an evidence-driven loop:

1. **Make the task concrete.** Extract the requested behavior, constraints and
   acceptance conditions; expose consequential ambiguities. Anchor terms to actual
   repository entities and source evidence.
2. **Investigate alternatives.** For debugging, maintain competing explanations,
   seek evidence against each, and choose the next useful graph/source/test query.
   Every proposed mechanism remains a hypothesis until supported.
3. **Build an implementation plan.** Connect required edits to consumers, existing
   patterns, tests and any migration sequence. Separate required edits from optional
   cleanup and explain why each file matters.
4. **Retrieve adaptively.** Request only missing bodies, paths or contracts. Track
   what the agent already saw and its source revision. Stop redundant retrieval;
   ask a precise question or report the missing evidence when progress stalls.
5. **Check the actual patch.** Recompute impact after editing. Detect plan/patch
   differences and resolve newly affected consumers. Editing remains with the host
   agent or developer, preserving the local query engine's narrow role.
6. **Verify and reconsider.** Use compiler/test/contract results to revise the
   hypothesis or patch. Report unresolved risks and requirements. Model-generated
   tests can help, but existing and independently specified acceptance tests remain
   essential; a test that repeats the model's mistaken assumption is weak evidence.

For account lockout, AI could propose reusing the existing helper, locating
construction sites and checking the effect on success/failure paths. It should
recognize that “should a successful login reset failures?” is a product decision
unless requirements already answer it. It can draft missing tests, then evaluate
the actual results and patch together.

This loop can run in the existing host agent without PGraph making model calls.
Optional internal model work should be reserved for a demonstrated gap, bounded by
task-level cost/time limits, cancellable, and cached with source/model/prompt versions.
Do not make a model call per node. A model's confidence score must not authorize
a factual claim or replace a verification result.

## Evidence contract shared by people and agents

Extend the IR/query envelope with stable entity IDs, per-root revisions, source
hashes and cited ranges, analysis/rule versions, and explicit coverage/limit flags.
For derived findings, distinguish supported-under-stated-assumptions, contradicted,
and unknown. Keep heuristic likelihood separate from that finding status.

Suggested task-level operations, subject to API design, are:

| Operation             | Result produced without a model                                  |
| --------------------- | ---------------------------------------------------------------- |
| `task_context`        | Anchors, relevant evidence, omissions and available expansions   |
| `change_impact`       | Changed contracts/symbols, affected paths and unknown boundaries |
| `explain_flow`        | Supported call/value paths, branch conditions and effects        |
| `verification_plan`   | Candidate checks, reasons and coverage limitations               |
| `verification_status` | Results for an identified source/configuration revision          |

These can be exposed through the existing `graph-tools` dispatch to both adapters.
They are proposed names; retain existing fine-grained tools for exploration. Keep
test execution in the editor/runner adapter rather than silently adding execution
to the currently read-only MCP tools.

## Build sequence and quality gates

| Stage | Deliverable                                                                       | Gate                                                                                |
| ----- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1     | Strict evidence mode, anchored/multi-field retrieval, implementation/test context | No model dependency or semantic-cache leakage; held-out retrieval improvement       |
| 2     | Diff-to-symbol impact, selected contract checks, test plan/results                | Known regressions and missing companion edits detected; stale results invalidated   |
| 3     | Bounded local flow summaries and cross-service payload links                      | Correct supported cases; explicit uncertainty for unresolved dispatch and topology  |
| 4     | Agent investigation/plan/patch/verification loop                                  | Better completed-task outcomes than the same agent using ordinary search/read tools |
| 5     | Optional internal model assistance                                                | Additional benefit beyond stage 4 justifies cost, latency and maintenance           |

The first product milestone should be useful in local mode: select a change, see
its evidenced impact, inspect the relevant implementation, and run a reasoned set
of checks. AI integrations then consume the same stronger capabilities.

Evaluate the three modes separately on held-out tasks using the same commits and
acceptance criteria. Measure time to a verified change, completion, missed impacts,
irrelevant findings and rework; for AI also count all source/tool context and exposed
model cost/latency. Include dynamic/unsupported examples that should return unknown.

The earlier 6/15 natural-language retrieval result motivates improvement; it does
not prove these proposals improve outcomes. This follow-up reviewed code and primary
technical documentation. It introduced no runtime implementation and ran no new
coding-task or live-model experiment.

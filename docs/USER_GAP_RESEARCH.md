# Where developers lose time, and how PGraph can earn adoption

Research date: 9 September 2026. Scope: the local PGraph 0.4.0 preview,
TypeScript/JavaScript developers, and agents consuming repository context.

## Decision

Focus the next release on **getting from an error or changed declaration to
source evidence and a useful verification step**. Make that path easy to start,
reliable to repeat, and measurable against the tools a developer already uses.
Feature count should no longer determine the next development milestone.

The strongest initial audience is a developer maintaining a TypeScript service or
package who repeatedly investigates code outside their immediate area. Include
developers using coding agents, but require the core workflow to be useful without
an AI account. The likely buying or rollout champion is a maintainer or team lead
who sees repeated investigation and review work. That commercial hypothesis still
needs interviews; public complaints do not identify a buyer or willingness to pay.

PGraph's proposed promise is: **find the code behind a change, inspect what may be
affected, and carry only the evidence you need into the next step**. Existing
features support this promise in bounded situations. They do not establish that
PGraph saves time on complete tasks, finds every dependency, or should be used by
every developer every day.

## What the evidence establishes

This investigation examined six first-person reports in public issue trackers and
an official product forum, checked current product documentation, and inspected
PGraph's implementation and existing measurements. Reports were selected for
indexing, code-context selection and context-cost problems. This is a purposive
qualitative sample: it establishes examples of affected users, not prevalence,
market size, comparative defect rates or PGraph customer demand. Multiple comments
in one discussion are not counted as independent studies.

Historical reports remain useful for understanding failure modes. Their age and
resolution matter: a closed 2025 report is not evidence that a competing product
still has the same defect in September 2026. Current vendor documentation is used
to check that distinction. Vendor performance claims are not independent tests.
No developers have been interviewed, recruited or observed using PGraph for this
research. The existing synthetic and self-repository probes are engineering
diagnostics, not customer outcomes.

### Direct reports of affected users

| Evidence                                   | Observed situation and consequence                                                                                                                                                                                                          | Date and status at inspection                                                                                                                           | Implication for PGraph                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| E1: GitHub Community discussion 151021[^1] | A developer reported waiting over eight hours for remote indexing of a roughly 2.5 GB repository, without a useful indication of progress. Replies also describe smaller projects and confusion about whether a usable shared index exists. | Opened 8 February 2025; discussion marked unanswered. Historical reports, not a reproduced current failure.                                             | Show progress, scope, freshness and a recovery action. Measure time until the first useful result, including setup failures.                 |
| E2: Cursor forum 71894[^2]                 | A developer reported an indefinite indexing state that also prevented normal chat work. Replies directed the user to logs and suggested several possible causes. Those suggestions do not establish a single root cause.                    | 28 March 2025; reported on Cursor 0.47.8.                                                                                                               | Keep the investigation interface responsive, make cancellation and recovery visible, and avoid claiming indexing is complete when it is not. |
| E3: Aider issue 752[^3]                    | A developer expected a 1,024-token repository-map setting to cap context, but observed over 16,000 map tokens. The maintainer explained dynamic expansion and corrected the documentation; a later comment requested a hard cap.            | Opened 30 June 2024; closed. A February 2025 follow-up discusses cost control.                                                                          | A budget must say exactly what it bounds. Count schemas, follow-up reads and protocol overhead separately from source snippets.              |
| E4: Aider issue 3187[^4]                   | A developer wanted to suppress repository-map context for individual questions unrelated to the repository, rather than pay to include it anyway.                                                                                           | Opened 8 February 2025; closed. Resolution behavior was not independently reproduced.                                                                   | Retrieval should be deliberate and task-specific. An always-attached graph dump can add waste.                                               |
| E5: Copilot issue 12366[^5]                | A developer reported losing the expected relationship between selected editor lines and chat context, disrupting an existing workflow.                                                                                                      | Opened 13 June 2025; closed, in an archived issue repository. Current VS Code documentation includes selected/visible text among available context.[^7] | Make file and cursor anchors explicit and inspectable; do not market the old complaint as an unresolved competitor gap.                      |
| E6: VS Code issue 329040[^6]               | A reporter supplied logs showing aggregate tool definitions exhausting a model's context budget and a silent failed request. Reducing enabled tools reportedly restored operation.                                                          | Opened 4 August 2026; open with a bug label and an agent-host-mitigated label. We did not reproduce the host failure.                                   | PGraph should offer a smaller tool surface and measure its own contribution. It cannot repair other servers or the host's budget accounting. |

Code search is also a recurring need independent of AI. A 2015 Google case study
combined survey and log analysis and reported frequent searches for API usage,
implementation behavior, failures and code locations. Many searches targeted
somewhat familiar code.[^8] This is historical, single-company evidence; it supports
those task categories, not a forecast of PGraph usage. It also challenges an overly
narrow assumption that only new hires or completely unfamiliar repositories need
help. Returning to partly familiar code after an interruption is a plausible pilot
scenario.

The common problem is an incomplete feedback loop: the developer searches, waits,
reads, discovers missing context, searches again, and still needs to check whether
the answer applies to the current change. PGraph's opportunity is to reduce those
extra steps while preserving correctness. This synthesis is a product inference
from the reports and repository audit, not a measured causal result.

## What users already have

| Alternative     | Capability documented today                                                                                                                                | Consequence for positioning                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code/Copilot | Semantic search, grep, file search, usages and file reads; agents can combine them and perform follow-up searches. Grep works without an index.[^7]        | Basic search and references are established capabilities. Compare complete investigations against these defaults.                                                 |
| Aider           | A concise repository map with important symbols and signatures, selected using graph ranking and an active token budget.[^9]                               | A graph plus compact context is not unique. Demonstrate source freshness, useful task selection and predictable limits.                                           |
| Continue        | Current guidance uses agent file/search tools, repository rules and optional MCP/RAG integrations. Its old `@Codebase` provider is deprecated.[^10]        | Integrate into an existing agent workflow. Do not build a comparison around obsolete setup instructions.                                                          |
| Cursor          | Its January 2026 engineering account describes content-hash updates, cached embeddings and reuse of teammate indexes to improve initial availability.[^11] | Fast indexing and index reuse are active competitive work. Local deterministic indexing is a deployment choice; faster real task completion remains to be proven. |
| Nx              | Git changes and a project graph identify affected tasks; dependency lockfile changes can conservatively affect all projects.[^12]                          | Complement configured task selection with declaration evidence. Static test candidates should not replace a project's required validation.                        |

PGraph can plausibly differentiate through the combination of local operation,
source-verified excerpts, explicit unknowns, changed-declaration context and
portable bounded tool outputs. Each component has alternatives. The combination
must win on a real workflow; a feature checklist cannot establish that it does.

Do not lead with a universal search replacement, guaranteed token savings or an
autonomous verification certificate. Also avoid a broad privacy claim when a
developer passes retrieved code to an external agent: local indexing does not make
that agent local. Explain the actual boundary: deterministic PGraph queries need
no model; the receiving agent operates under its own configuration.

## Ten gaps, with closure criteria

Priorities below express product judgment, not a frequency score calculated from
the issue sample. P0 items block a credible adoption claim; P1 items improve a
promising workflow once that claim has evidence. A gap is closed only when its
engineering check and relevant user observation pass.

| Priority / gap                              | PGraph evidence now                                                                                                                                                                                               | Next action and definition of closed                                                                                                                                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 / 1. First useful result                 | The preview needs a separate supported Node installation and explicit initial indexing. The README previously led with source-build commands under a one-minute heading. No novice activation measurement exists. | The new first-use guide starts with the installable extension and a concrete task. Next observe fresh installations across supported systems; record every failure and help request. Close when the agreed unassisted activation gate passes.            |
| P0 / 2. Index uncertainty                   | Progress, elapsed time, cancellation, restart and live supported-input health exist. The sidebar's stored index state is not a live filesystem audit. No representative cold-start study exists.                  | Test slow/failed indexing, a stale source, a changed ignore rule and recovery. The user must identify whether evidence is usable and recover without deleting unexplained cache files.                                                                   |
| P0 / 3. Finding the right code              | The previous natural-language self-repository diagnostic recovered 6 of 15 target symbols; exact identifiers did much better. This is a small diagnostic, not a held-out score.                                   | Build maintainer-labeled tasks with errors, identifiers, file/line anchors and unanchored descriptions. Compare required evidence and extra reads against existing tools. Improve local retrieval where this test fails; preserve an explicit fallback.  |
| P0 / 4. Whole-task context cost             | Source budgets and receipts exist, but the server exposed all 21 tools. Historic savings probes did not measure completed agent tasks.                                                                            | Implemented an optional six-tool MCP profile and a reproducible schema probe. Close the outcome gap only after counting all observable context and retries on accepted tasks, with unknown host tokens reported as unavailable.                          |
| P0 / 5. Agent actually uses the integration | Registration tests prove tools can be invoked. They do not prove a live agent discovers, selects or correctly interprets them.                                                                                    | Provide a minimal selectable tool set and explicit task prompt. Observe both prompted first use and later spontaneous use in the chosen host. Count ignored tools, wrong-root requests and duplicate full-file reads as failures.                        |
| P0 / 6. Trust and verification              | Hash checks, source ranges, change modes, static test paths and scoped process receipts exist. Dynamic dispatch, deleted-symbol history and complete runtime inputs remain incomplete.                            | Have a maintainer assess omitted impact and whether candidate tests are mistaken for coverage. Preserve unknowns and required CI checks. Any materially misleading verification claim blocks release.                                                    |
| P0 / 7. Product outcome evidence            | 61 tests passed before this research change; synthetic probes show specific mechanical improvements. There are no observed PGraph customer tasks or retention results.                                            | Run the opt-in pilot below, including failures and ordinary tasks where PGraph may lose. Publish denominators and limitations before making productivity claims.                                                                                         |
| P1 / 8. Human navigation and recovery       | Daily reports show paths and lines in Markdown; they do not yet offer a complete clickable investigation flow. Empty and truncated results need usability observation.                                            | Observe users going from report to source and recovering from no match. Prioritize validated source navigation and one clear next action if this causes repeated copying or abandonment. This UI improvement is not implemented by this research change. |
| P1 / 9. Repository fit                      | Supported TS/JS patterns work in fixtures. Source maps, complete dynamic frameworks, historical impact and some cross-service reasoning remain outside the query guarantees.                                      | Maintain a tested compatibility matrix using pilot repositories. Exclude unsupported workflows from launch promises; prioritize new adapters from repeated observed blockers.                                                                            |
| P1 / 10. A reason to return and recommend   | Saved investigations and the daily launcher exist. We have no evidence of voluntary reuse, willingness to pay or referrals.                                                                                       | Ask about the next real relevant task, then measure unprompted reuse among developers who had such a task. Interview abandoners. Expand distribution only when a specific recurring benefit is observable.                                               |

The release checklist in [V2 delivery](V2_DELIVERY.md) remains authoritative for
technical release gates. This matrix adds product gates; passing tests cannot
substitute for activation or task-outcome evidence.

## Changes made from this investigation

The MCP server now accepts `--tool-profile essential`. It registers only
`workflow`, `context`, `search`, `excerpt`, `file_slice` and `impact`. The default
remains `full` for existing clients. The smaller profile uses the same schemas,
dispatcher and evidence; other operations require restarting with the full profile.
There is no hidden router exposing every removed operation and no model call.

A real stdio probe compares advertised tool definitions, server instructions and
three identical requests across profiles. The results and limits are recorded in
[the profile report](../benchmarks/reports/tool-profiles.json). This measures a
smaller discovery payload, not a fixed percentage reduction in model bills.
The advertised tool arrays cost 3,563 versus 1,421 BPE tokens, a 60.1% reduction;
server instructions cost 64 versus 100 tokens separately. The three sampled
query responses were identical across profiles.
More follow-up calls can offset an initial saving, and hosts may defer or cache
tools differently. A VS Code user tool-set example is provided separately; merely
adding a group does not deselect other enabled tools.

Testing found that passing only a schema's shape to MCP allowed the SDK to strip
unknown arguments before dispatch. The server now passes the strict schema itself,
so malformed calls fail instead of silently changing meaning. The configured
repository was already fixed; this corrects the validation contract. Both profiles
retain read-only repository access.

Validation of the updated source: 63 tests across 11 files passed, including real
MCP stdio interaction for both profiles; typechecking, lint and formatting passed.
The user tool-set example references six names present in the extension manifest.
Those checks do not establish a live model's tool choice or task correctness.

[First useful result](FIRST_VALUE.md) now provides an extension-first walkthrough,
separate non-AI and agent paths, and concrete recovery instructions. The README
links to it before the feature catalog and no longer promises a one-minute source
build. This closes a documentation gap. It does not prove the onboarding experience
is easy; that needs fresh-user observation.

## Getting the first users

Start with an opt-in pilot of eight developers from at least three teams or
repositories in the intended TS/JS segment. This is a learning cohort, not a
statistically representative market test. Include developers who rely on ordinary
editor tools and developers who already use agents. Include maintainers and
contributors returning to partially familiar code. Do not require dissatisfaction
with their current tool as a recruitment condition.

Use existing relationships and relevant maintainer communities for invitations
after a concrete build, task demo and feedback process are ready. Public issue
authors are evidence sources, not a mailing list. Do not contact them unsolicited
or post promotional replies into bug reports. A maintainer should choose a real
task and decide what constitutes a correct result before the session begins.

Offer one narrowly scoped demonstration: a bug's source, related call sites and
the checks that actually apply. Show the same task with normal editor/agent tools.
Make failures, extra steps and unsupported behavior visible. A useful artifact is a
short task walkthrough with a reproducible fixture and the exact build version;
a generic graph animation is less relevant to the proposed buying decision.

After a successful pilot, concentrate distribution on that demonstrated job:
a troubleshooting tutorial, a maintainer's consented case study, a clear VSIX
installation path, and host-specific integration instructions. Marketplace/npm
publication and any outreach are separate actions; neither has been done here.
Pricing, broad acquisition spending and enterprise packaging should follow evidence
of recurring value and purchase authority, not precede it.

## Pilot design and decision rules

Use the [pilot kit](USER_PILOT.md) to capture recent concrete incidents, an unassisted
first-use attempt and comparable real tasks. Counterbalance which workflow is used
first. Repeating the identical task creates a learning effect; use matched tasks
with the same acceptance standard and record remaining differences. Separate
deterministic editor evaluation from evaluation of a specific agent/model/version.
Observe setup time, total elapsed time, active investigation time, accepted outcome,
review effort and observable context traffic. Include failed and abandoned runs.

Proposed pilot thresholds are product decision rules, not achieved results or
statistical confidence bounds:

- At least 6 of 8 participants reach a source-backed first useful result without
  live coaching within ten minutes of beginning installation. Report cold indexing
  separately and retain failures in the denominator.
- On at least 24 matched task pairs, a maintainer accepts the outcome and PGraph
  shows at least a 20% median reduction in active investigation time, without a
  lower accepted-outcome rate or a material increase in review/rework. Report the
  spread, per-repository results and every serious miss. Small-sample success
  justifies further evaluation, not a universal productivity claim.
- Agent cost claims require observable end-to-end counters. If the host hides
  costs, publish the measured repository-context component and label total cost
  unavailable. Do not replace unknown values with zero. A schema-only reduction
  is not this gate.
- At least 5 of 8 participants voluntarily use PGraph again on two later relevant
  tasks within fourteen days. Record who had no eligible task; report that cohort
  separately rather than interpreting lack of opportunity as rejection.
- No unresolved instance in which stale or incomplete evidence is presented as a
  complete verification result. Fix and retest the failure before wider release.

If developers cannot get started, improve installation and recovery. If they start
but evidence is missing, improve retrieval and repository support. If results are
correct but slower, reduce steps and host overhead. If a task is faster but nobody
returns, revisit the task's frequency and the audience. Add a feature only when it
addresses one of these observed blockers, with a before/after task check.

## Direct PGraph incident: workspace selection

On 10 September 2026 the maintainer reported Git HEAD lookup failing in an opened
parent folder and requested both workspace and single-project use. A read-only
inspection found 31 direct child Git repositories and no Git repository at the
parent. This is a concrete PGraph activation failure; one report does not establish
how frequently other developers encounter it.

VS Code explicitly supports several related folders in one workspace and adds
folder identity to ambiguous file names. That supports offering both scopes while
preserving project identity. It does not imply that folders in separate windows
form one workspace. [VS Code multi-root documentation](https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces)
(checked 10 September 2026).

The local 0.5.x preview addresses the incident with direct-child discovery,
per-project indexes/Git baselines, scope selection and isolated failures. The
0.5.1 follow-up also packs editor/agent task context under one output budget and
requires explicit project identities for agent follow-up reads in Workspace scope.
This prevents an editor-focus change from silently choosing the wrong repository.
The [workspace contract](WORKSPACE_GRAPH.md) records supported behavior and limits.

The remaining user test is unassisted use on the maintainer's actual workspace:
successful installation, first useful source result, an investigation crossing
two services, and measured time/memory. Fixture success alone does not close that
gap or establish adoption. The original repositories were not altered to stage
this test, and the preview has not been installed in the normal editor profile.

## Sources

All web sources below were inspected on 9 September 2026. Issue observations are
attributed reports, not independently verified defects in current releases.

[^1]: GitHub Community, [How long does remote workspace indexing take? Does it work? #151021](https://github.com/orgs/community/discussions/151021), opened 8 February 2025.

[^2]: Cursor Community Forum, [Codebase Indexing gets stuck in an infinite loop on Loading forever](https://forum.cursor.com/t/codebase-indexing-gets-stuck-in-an-infinite-loop-on-loading-forever/71894), 28 March 2025.

[^3]: Aider, [Repository map token limit not respected #752](https://github.com/Aider-AI/aider/issues/752), opened 30 June 2024, including maintainer explanation and later follow-up.

[^4]: Aider, [Is there a way to temporarily disable sending the repo map for some requests? #3187](https://github.com/Aider-AI/aider/issues/3187), opened 8 February 2025.

[^5]: Microsoft, [The chat can no longer read the selected lines of the open file as context #12366](https://github.com/microsoft/vscode-copilot-release/issues/12366), opened 13 June 2025.

[^6]: Microsoft, [Chat requests fail silently when tool definitions exceed the model's context budget #329040](https://github.com/microsoft/vscode/issues/329040), opened 4 August 2026.

[^7]: VS Code, [How Copilot understands your workspace](https://code.visualstudio.com/docs/agents/reference/workspace-context), current documentation; publication date not stated.

[^8]: Caitlin Sadowski, Kathryn T. Stolee and Sebastian Elbaum, [How Developers Search for Code: A Case Study](https://research.google/pubs/how-developers-search-for-code-a-case-study/), ESEC/FSE 2015, Google Research publication and abstract.

[^9]: Aider, [Repository map](https://aider.chat/docs/repomap.html), current documentation; publication date not stated.

[^10]: Continue, [How to Make Agent Mode Aware of Codebases and Documentation](https://docs.continue.dev/guides/codebase-documentation-awareness) and [deprecated Codebase provider](https://docs.continue.dev/reference/deprecated-codebase), current documentation; publication dates not stated.

[^11]: Jeremy Stribling, Cursor, [Securely indexing large codebases](https://cursor.com/blog/secure-codebase-indexing), 27 January 2026. Vendor engineering account, not an independent PGraph comparison.

[^12]: Nx, [Run Only Tasks Affected by a PR](https://nx.dev/docs/features/ci-features/affected), current documentation; publication date not stated.

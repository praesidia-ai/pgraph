# PGraph as a daily developer tool

## Product decision

PGraph should help a developer answer one recurring question: **“What do I need to
understand and check to finish this change?”** Its strongest initial audience is
developers maintaining TypeScript/JavaScript services and packages, including those
using coding agents. The 0.4.0 preview builds a connected workflow around this
problem: locate evidence, identify edited declarations, inspect dependencies and
test candidates, run an existing check, and resume the investigation later.

This is an implementation-backed product hypothesis. It is not evidence that every
developer needs PGraph on every task, or that eleven additional features establish
product-market fit. Small familiar changes can be faster with ordinary editor
navigation. PGraph earns repeated use when it removes uncertainty on unfamiliar,
interrupted or cross-file work and makes verification evidence easy to inspect.

The proposed positioning is **local change intelligence for developers and their
agents**. The engine supplies bounded, inspectable evidence without model calls.
Existing agents can interpret that evidence, while developers have ordinary editor
commands and readable reports. Internal AI should be added only after a controlled
comparison shows a benefit beyond the same host agent using these local tools.

## Evidence and its limits

Microsoft/GitHub's developer-experience research, conducted with DX using responses
from more than 2,000 developers, connects cognitive load, flow and feedback loops
with individual and team outcomes. Its feedback measures include getting answers
and completing reviews. This supports shortening investigation and verification
loops; the observational results do not predict a causal uplift from PGraph.[^1]

Stack Overflow's 2025 survey reports that 66% of respondents to the AI-frustration
question encountered solutions that were nearly correct, and 45% reported that
debugging generated code took more time. Separately, 46% distrusted AI accuracy and
33% trusted it. These are self-reported responses, not controlled estimates of
all developers' behavior. They nevertheless identify an important product need:
make evidence and verification available at the point where a developer must
decide whether to accept a change.[^2]

DORA's 2025 report describes AI as amplifying an organization's existing strengths
and weaknesses. For PGraph, the inference is to improve the surrounding workflow:
source freshness, clear change boundaries and available checks. A stronger model
does not itself establish which snapshot a test result applies to.[^3]

The productivity evidence also cautions against broad speed claims. METR's July
2025 randomized study involved 16 experienced contributors completing 246 tasks in
familiar repositories; AI availability increased completion time by 19% in that
setting. That is a historical result for those tools and tasks, not a claim about
current models or all developers.[^4] METR's February 2026 update reported selection
and time-measurement problems in its subsequent study and described the data as an
unreliable estimate of current uplift. It considered improvement likely but the
magnitude weakly established. The appropriate response is paired local evaluation,
not selecting whichever headline favors the product.[^5]

The SPACE framework argues that productivity cannot be represented by one activity
metric.[^6] Microsoft's newer EngThrive work organizes improvement around speed,
ease and quality, with developer wellbeing as a guardrail.[^7] Consequently, daily
active usage, generated context volume, fewer tokens and number of checks run are
diagnostics. None independently measures successful delivery.

Existing tools establish both demand and competition. Nx already combines Git
changes with a project graph to choose affected project tasks, and documents broad
invalidation after dependency changes.[^8] PGraph should complement that workflow
with declaration-level evidence and clear unknowns, rather than claim it can
replace a configured task graph. VS Code already provides task execution primitives,
including process execution with explicit arguments.[^9] Reusing this interface
keeps output and cancellation in a familiar developer surface.

Git explicitly supports different comparisons involving commits, the index and the
working tree.[^10] Those are materially different inputs. A staged review must not
silently describe an unstaged body, and a branch comparison needs an explicit base.
PGraph now preserves those distinctions and refuses declaration mapping when the
selected Git snapshot differs from the indexed working source.

## Problems worth solving repeatedly

The most promising first adoption moment is an unfamiliar bug or small change in a
repository the developer already works in. The developer has an error message, a
stack frame, an edited file or a known symbol. These concrete anchors are stronger
than asking a weak natural-language retriever to infer the entire task. PGraph can
then return evidence at the appropriate level instead of requiring repeated broad
file reads.

A second adoption moment is pre-commit review. Existing file-level review includes
unrelated declarations when only one method changed. Mapping textual hunks to
current declarations narrows the initial inspection surface. It must preserve
unknown areas for deleted code, configuration and snapshot mismatches; narrowing
must not be presented as proof that other code cannot be affected.

A third moment is verification. Developers need to find the actual package scripts,
run one deliberately, and see whether its result still applies to the supported
inputs. A check that exited successfully before a source edit is different evidence
from a current result. PGraph's new receipts expose that distinction while making
clear that a process exit code is not a complete CI or correctness certificate.

A fourth moment is interruption. A saved investigation should retain a task and a
stable symbol identity, then retrieve fresh evidence when resumed. Persisting an old
source dump would make resumption convenient but unreliable. The implementation
stores task anchors in the local VS Code workspace state and resolves them again.

## Eleven delivered capabilities

These are additions to the 0.3.0 preview. The daily launcher, keyboard shortcut and
readable reports are supporting surfaces, not extra features counted toward eleven.

| #   | Developer problem                                    | Delivered capability                                                                               | Entry point                                              |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | “Can I rely on this index?”                          | Live supported-input freshness, added/deleted-file detection and configuration drift               | Check Index Freshness / `workflow health`                |
| 2   | “Where is this exact error produced?”                | Literal source search with matching lines, hashes, symbol IDs, scope and pagination                | Find Exact Source Text / `workflow text`                 |
| 3   | “What source does this stack trace point to?”        | Relative, absolute and file-URL frame mapping; unresolved frames remain explicit                   | Investigate Stack Trace / `workflow trace`               |
| 4   | “What uses this file?”                               | Declarations, outgoing file dependencies and current consumers                                     | Understand Current File / `workflow file`                |
| 5   | “Why are these modules coupled?”                     | Bounded multi-file dependency-cycle components                                                     | Find Dependency Cycles / `workflow cycles`               |
| 6   | “Which declarations did I edit?”                     | Git hunks mapped to current declarations, excluding unrelated siblings where supported             | Show Changed Declarations / `workflow changes`           |
| 7   | “Am I reviewing my staged patch or my branch?”       | Separate working, staged and explicit merge-base branch comparisons                                | Review Staged Declarations / Compare Branch Declarations |
| 8   | “Which edited functions lack a known test path?”     | Changed-target test candidates and explicit no-path/unknown assessments                            | Find Change Test Gaps / `workflow test_gaps`             |
| 9   | “How is this package checked?”                       | Supported package-script discovery with manager, working directory and script body                 | Discover Repository Checks / `workflow checks`           |
| 10  | “What check ran, and is its evidence still current?” | Deliberate VS Code task execution, exit records and supported-input freshness after edits/restarts | Run Repository Check / Show Recorded Checks              |
| 11  | “How do I resume this investigation?”                | Save, resume and remove local task/symbol bookmarks with fresh retrieval                           | Save Investigation / Resume Investigation                |

An example daily sequence is: search an error, inspect its declaration, edit the
implementation, review changed declarations, inspect test candidates, run a package
check and examine its receipt. Another developer may only use file consumers and
save an investigation. The launcher exposes these jobs through one command and a
status-bar entry, with no automatic popups or forced sequence.

## Technical choices and practical boundaries

Live health uses the same discovery rules as indexing. Its fingerprint includes
supported source, relevant manifests and indexed configuration. It detects new
supported files as well as modified/deleted files and configuration drift. It does
not fingerprint every runtime input: excluded files, external dependencies,
environment variables and other assets remain outside its evidence. Health is an
explicit action because a full repository hash scan can be expensive.

Literal search is intentionally a fallback for concrete text. It reads only indexed
files, validates their hashes and omits stale/unreadable results with warnings. It
caps the scan at 2,000 files and 20 MB and caps returned lines. The reported cursor
supports result pagination; reaching the scan cap requires narrowing scope. It is
not a replacement for an unrestricted text-search engine on arbitrary binary or
unindexed files.

Stack-frame mapping checks repository membership and source freshness. Canonical
filesystem paths allow aliases such as macOS temporary-directory paths to resolve
to the same indexed file. Source maps, runtime-generated code and external libraries
remain unresolved. A matching frame provides a navigation anchor, not a causal bug
diagnosis. The caller should inspect surrounding code and error propagation.

File overviews and cycle components use the current committed graph. Cycle analysis
is limited to 1,000 source files, bounded dependent lists and 30 reported components.
These are strongly connected file groups, not enumerations of every cycle and not
proof of a runtime initialization fault. Reindex before relying on those structural
results after a change.

Hunk mapping selects current declarations overlapping changed lines. For an edit
inside a method, it prefers a containing method over its enclosing class. It keeps
deletion and top-level uncertainty visible. This is textual mapping, not a
before/after semantic contract comparison, removed-symbol consumer reconstruction,
or a complete impact proof. The previous conservative file review remains available.

The test-gap report applies the existing bounded static test-path engine to changed
callable declarations. “No static test path found” is different from “untested.”
Reflection, indirect framework registration and runtime injection can hide paths;
a discovered test may not exercise the modified branch. Possible interface dispatch
retains its uncertainty label. These candidates complement required package/CI
checks and do not automatically narrow execution.

Check discovery recognizes test, check, typecheck, lint and build script names,
including a bounded suffix, across indexed package manifests. It reports the actual
script body and inferred or declared package manager. It excludes deployment scripts
from this launcher. Discovery makes no process call to execute the script. Choosing
Run executes the selected repository script and its package-manager lifecycle hooks
through a VS Code task; it requires a trusted local workspace.

Recorded results distinguish success, failure and an unavailable/cancelled process
result. The engine captures a supported-input fingerprint before execution and
compares it afterward. Results become stale when that fingerprint changes and are
retained locally across worker restarts. A restarted worker cannot complete an
unknown pending run. The recorded scope does not include the complete environment,
so the interface describes current tracked inputs rather than a universal verified
state. No terminal output is sent to an external service by this feature.

Bookmarks retain a task and optional stable declaration ID, not a persistent source
answer. Renamed or removed declarations require a new anchor. The store is bounded
to 30 investigations per VS Code workspace, filtered by repository when shown.
The feature is local workspace state, not team-shared project memory.

## Keeping agent use economical

The nine read-only evidence actions share one additional `workflow` tool instead
of registering a separate tool for every editor command. This limits discovery
schema growth, although it does not make the new schema free. Tool descriptions
identify the concrete inputs each action needs and explicitly exclude execution.
The editor check runner is not exposed as an agent action in this preview.

Agents should use the strongest available anchor. An exact error goes to literal
search; a stack trace goes to frame mapping; a patch goes to changed declarations;
a known symbol goes to ordinary context or source retrieval. A generic context
request remains available but should not conceal its known natural-language recall
limitations. The 0.3.0 self-repository diagnostic retrieved only 6 of 15 inherited
natural-language targets. That is a reason to improve retrieval and expose concrete
workflows, not a basis for claiming general repository understanding.

The previous context receipts still support reuse while the caller retains the
referenced evidence. A new agent session or compacted history should request full
context. More useful source may cost more tokens than a signature-only answer.
Measure every request, response, follow-up read and exposed schema in representative
complete tasks; do not transfer an earlier synthetic token-saving percentage to
these new workflows without measuring it again.

## Adoption and evaluation plan

The first pilot should involve a small opt-in group maintaining the intended
TypeScript/JavaScript service workspace. Collect recent completed bugs and changes,
then select new tasks with independently agreed acceptance checks. Include familiar
and unfamiliar code, at least one interrupted investigation, and several situations
where ordinary editor tools are expected to be sufficient. This prevents evaluating
only tasks selected to favor the graph.

Observe the first useful result: can a developer get from a concrete error or edited
file to evidence they trust without being taught graph terminology? Record initial
index setup time, failed queries, stale results, unnecessary navigation and moments
when the developer abandons PGraph. Ask what evidence was missing at the point of
abandonment. A false implication of safety is a higher-priority defect than a
missing convenience command.

Use a paired or randomized comparison where practical. Keep the starting commit,
host agent/model, repository permissions and required checks consistent. Record
wall-clock completion time, active effort, acceptance outcomes, missed impact and
rework after review. Count all agent-visible requests and responses, not just the
first context package. For concurrent-agent use, distinguish elapsed time from
human effort instead of assuming they are interchangeable.

Repeated use should be voluntary and tied to useful outcomes. Suggested pilot
criteria are faster median time to a relevant declaration, fewer unrelated files
inspected before a correct edit, no increase in missed required checks, and developers
choosing to return to at least one workflow in a later week. These are proposed
acceptance criteria, not achieved statistics. Use distributions and inspect the slow
or failed cases rather than reporting only an average improvement.

Do not use command counts to rank developers. Keep any pilot feedback collection
explicit, local or separately consented, and focused on product friction. The shipped
preview does not add background usage telemetry. An interview or locally shared task
trace can be more informative than a dashboard showing that a command ran often.

Broader rollout depends on supported language/framework precision, upgrade behavior,
latency and memory on real workspaces, and platform testing. Adoption outside the
initial TS/JS audience needs additional language adapters and genuine user evidence.
“Every developer, every time” is an aspiration; the testable promise is a better
experience for a specific recurring job.

## Next priorities after this preview

First, evaluate hunk mapping and candidate-test usefulness on real changes, especially
deletions, renames and configuration edits. Then add baseline symbol snapshots and
supported contract comparisons where the pilot demonstrates missed impact. These
should preserve explicit uncertainty instead of replacing the current conservative
fallback with an overconfident smaller result.

Second, connect context and impact across the workspace roots already present in
the relationship explorer. A useful service-level result needs both endpoint
revisions, payload evidence, ambiguity and a shared token budget. A graph connection
alone does not prove compatibility or tell a developer which verification to run.

Third, connect a supported test runner's structured outcomes and coverage information
to source revisions. The current package-process receipt is a useful first step;
it does not identify individual tests, assertions or changed-branch coverage. Keep
required CI checks visible when introducing more selective execution.

Finally, evaluate stronger task retrieval and optional AI interpretation against
the same deterministic evidence workflow. Add a model only where it measurably
improves completion or reduces effort without hiding uncertainty. The product's
advantage should come from reliable repository evidence and a short path to a
verified change, not from the number of graph nodes or generated explanations.

## Sources

[^1]: Microsoft Azure / Developer Experience Lab. [Quantifying the impact of developer experience](https://azure.microsoft.com/en-us/blog/quantifying-the-impact-of-developer-experience/), 2024. Research summary; accessed 9 September 2026.

[^2]: Stack Overflow. [2025 Developer Survey: AI](https://survey.stackoverflow.co/2025/ai), 2025. Question-specific respondent counts and self-reported AI frustrations/trust; accessed 9 September 2026.

[^3]: DORA. [State of AI-assisted Software Development 2025](https://dora.dev/research/2025/dora-report/), 2025. Official report overview; accessed 9 September 2026.

[^4]: Becker, Rush, Barnes and Rein / METR. [Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/), 10 July 2025.

[^5]: Becker, Rush, Cunningham, Rein and Mahamud / METR. [We are Changing our Developer Productivity Experiment Design](https://metr.org/blog/2026-02-24-uplift-update/), 24 February 2026.

[^6]: Microsoft Research. [The SPACE of Developer Productivity: There's more to it than you think](https://www.microsoft.com/en-us/research/publication/the-space-of-developer-productivity-theres-more-to-it-than-you-think/), 2021.

[^7]: Microsoft Research. [EngThrive: Make It Fast and Easy to Do Great Work](https://www.microsoft.com/en-us/research/publication/engthrive-make-it-fast-and-easy-to-do-great-work/), publication page accessed 9 September 2026.

[^8]: Nx. [Run Only Tasks Affected by a PR](https://nx.dev/docs/features/ci-features/affected), current documentation accessed 9 September 2026.

[^9]: Visual Studio Code. [Task Provider](https://code.visualstudio.com/api/extension-guides/task-provider), current API guide accessed 9 September 2026.

[^10]: Git. [git-diff documentation](https://git-scm.com/docs/git-diff), current documentation accessed 9 September 2026.

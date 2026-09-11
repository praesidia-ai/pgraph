# PGraph user pilot kit

Status: ready to use, no participants recruited or results collected.
Research basis: [user gaps](USER_GAP_RESEARCH.md). Record exact build hashes; the
local preview is 0.5.5, including Project/Workspace context and historical review
continuation. The optional essential MCP profile exposes six tools.

## Recruitment

Seek eight volunteers across at least three TypeScript/JavaScript repositories or
teams. Include developers who use ordinary editor navigation and those who already
use coding agents. Include maintainers and contributors who revisit code outside
their immediate area. Recruit people with a recent, concrete investigation and a
new comparable task; do not require them to say their existing tools are bad.

Screen for these facts, without collecting source code or personal identifiers:

1. What languages, repository size and editor do you use for this work?
2. What was the last bug or change that required finding code outside your usual
   files? Roughly when did it happen, and what steps did you take?
3. Which tools did you use, and where did you wait, repeat work or ask someone?
4. Do you have another suitable task with acceptance checks a maintainer can assess?
5. Can you install a local VS Code extension and supported Node runtime? If an
   organizational restriction prevents it, record the blocker rather than asking
   the participant to bypass it.

Draft invitation, for an approved opt-in channel or an existing relationship:

> We are testing PGraph, a local TypeScript/JavaScript code investigation extension.
> We want to observe where finding code and checking a change takes unnecessary
> effort. Could you try it on one real task and compare it with your normal tools?
> The core workflow needs no AI account. We will record setup, missing information
> and task outcome, including cases where it does not help. You can keep your source
> private and stop at any point. The first session is about 45 minutes, with an
> optional follow-up on later work.

This is a draft, not a sent message. Do not treat issue authors as leads, scrape
their contact details, or insert promotional replies into unrelated support threads.

## Interview before the demonstration: 10 minutes

Ask the participant to reconstruct the most recent incident. Ask what triggered
the investigation, what evidence they needed, where they searched, which result
was missing, and how they knew they were finished. Record concrete steps and
artifacts where the participant is comfortable sharing them. A remembered duration
is an estimate; label it as such.

Ask what they would use if PGraph did not exist. Ask which part already works well.
Ask whether they have tried an alternative and why they kept or abandoned it.
Avoid asking whether they like graphs, want smarter AI, or would use an imagined
feature. Those questions invite opinions without establishing a recurring problem.

At the end, ask who decides whether a tool may be installed and who, if anyone,
could approve a paid rollout. Record the role and process, not an assumed buyer.

## First-use observation: up to 10 minutes

Give the participant the agreed build and [first-use guide](FIRST_VALUE.md). Ask
them to locate the relevant source for their task and explain why it is useful.
Start the timer at the beginning of installation. Record Node setup, extension
installation, trust prompts, index waiting, command discovery and recovery.

Do not coach during the unassisted attempt. If the participant asks for help or
gets stuck, record that first. Help them afterward so the rest of the session is
productive. An assisted recovery does not retroactively count as unassisted success.
Stop the observation if requested or if it interferes with their work.

The first useful result requires a source location that the developer inspects
and accepts as relevant. An index count, tool invocation or generated explanation
alone does not qualify. Record what remained unknown even after that result.

## Comparative task observation: 20–25 minutes initially

Have a maintainer define the acceptance criteria before either workflow. For a
longer task, this session can observe only the investigation portion; record full
completion and review later. Never label an unfinished task as accepted.

Use matched tasks and counterbalance whether normal tools or PGraph comes first.
The target is three matched pairs per participant across the pilot period, for
24 pairs in total. The first session starts one investigation; schedule additional
observations only with the participant's agreement. Record shortfalls rather than
inventing pairs or extending the cohort silently.
Avoid asking the same developer to solve an identical task twice and attributing
the learning effect to the second tool. Record differences in task complexity and
familiarity. Keep the editor, model, model settings and other tools as comparable
as practical. Keep human-only and agent-assisted results in separate groups.

Include tasks where PGraph may fail or add unnecessary work:

| Task                                 | Required observation                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Exact error or stack frame           | Can the developer reach the correct current source and identify unresolved frames?               |
| Small change among many declarations | Does the narrow result omit unrelated siblings while retaining unknown impact?                   |
| Existing API usage                   | Can the developer find a real relevant caller, implementation detail and applicable check?       |
| Broad task description               | Does retrieval miss a needed symbol, and can the developer recover without repeated broad reads? |
| Stale index or changed branch        | Does the interface expose the mismatch and make recovery understandable?                         |
| Familiar one-file edit               | Does PGraph add more steps than ordinary navigation?                                             |
| Resume after an interruption         | Does a saved anchor return useful fresh evidence?                                                |
| Indirect or dynamic behavior         | Does the participant mistake a missing static path for evidence that nothing is affected?        |

Count setup, time waiting, investigation, edits, checks and review/rework separately.
For agents, count observable requests, responses, schema payloads, retries and extra
source reads across the complete task. Record provider counters only when available;
separate cached/uncached input where exposed. PGraph's `cl100k_base` estimates are
not exact counters for every model. Hidden host tokens and fees are **unavailable**,
not zero. Do not collect raw code or prompts centrally by default.

## Neutral debrief: 5 minutes

Ask: What step would you remove? What result did you distrust? What did your normal
tools do better? What was still missing? What real upcoming task would justify
opening PGraph again? If they would not return, ask why without trying to persuade
them. A compliment or a feature request is not evidence of repeated use.

## Local observation record

Copy the template below for each session. Use pseudonymous participant and
repository IDs. Keep notes locally and obtain consent before sharing a recording,
quotation, code example or case study. The extension does not automatically upload
this record.

```text
Participant ID / repository ID:
Date / observer:
Consent and permitted use of observations:
Build version / artifact SHA256:
OS / Node / editor / agent host / model and settings:
Repository size / supported and unsupported patterns:
Task category / familiarity / task pair ID / workflow order:
Acceptance criteria and assessor:
Normal tools and baseline workflow:
Installation outcome / blocker:
Cold index elapsed / files indexed:
First accepted source result elapsed / location accepted? / help needed?:
Active investigation minutes:
Waiting minutes:
Editing, checks, review and rework minutes:
Task outcome: accepted / rejected / incomplete / abandoned
Missing required evidence / misleading evidence / extra reads:
Observed request/response/schema tokens and counting method:
Provider input/cache/output counters, or unavailable:
PGraph tool calls / retries / omitted-tool requests:
What normal tools did better:
Recovery action and outcome:
Next relevant task, if one is expected:
Voluntary repeat uses / eligible tasks / observation dates:
Decision: fix activation / retrieval / interaction / fit / continue evaluation
```

## Fourteen-day follow-up and decision

Agree to a follow-up during recruitment. Ask which relevant tasks occurred and
whether the participant chose PGraph without a reminder to use it. Separate no
opportunity from attempted use, abandonment and successful reuse. Record setup
support burden as a cost of adoption. Do not infer retention from status-bar clicks.

Apply the proposed thresholds in the research report to a table of actual results.
For the planned 24 matched pairs, report raw task outcomes, medians and spread,
including all failures. Small samples do not establish broad causal productivity
effects. If the result depends on one repository or one model, narrow the claim.

Before wider promotion, require a working installation path, a repeatable task
benefit, no materially misleading evidence, and voluntary reuse. Assign the next
engineering task to the most common observed blocker. Publish only consented
examples and measured claims with their denominators and limitations.

# Get a useful answer from PGraph

Use PGraph when you have a TypeScript/JavaScript error, an unfamiliar symbol or a
change whose surrounding code needs investigation. Start with one real question:
**Where does this happen, what else may be affected, and what should I check?**

## Install the preview

1. Install Node.js 22.18 or later on the computer running the extension. The VSIX
   does not install Node. In Terminal, check `node --version` and
   `node -p "process.execPath"`.
2. Use VS Code's **Extensions → Install from VSIX** with the supplied
   `pgraph-0.6.0.vsix`. In this development checkout the built artifact is in
   `artifacts/`. The project does not assume a Marketplace or npm publication.
   To build it yourself, follow [the source setup](../README.md#build-from-source).
3. Open the repository folder you want to investigate. PGraph requires a trusted
   filesystem workspace. If VS Code cannot find Node, set **PGraph: Node Path** in
   user settings to the executable path from step 1 on this computer.
4. Use **PGraph: Choose Scope** for one project or the workspace. A parent folder
   containing direct Git repositories is recognized as a workspace of projects.
   Run **Index Repository** for one project or **Index Workspace** for all of them.
   Progress shows the current phase and elapsed
   time; details are in the **PGraph** output channel. Indexing can be cancelled.
   Large repositories take longer, so wait for the completion result.
5. Run **PGraph: Check Index Freshness**. Inspect the reported scope and any warnings.
   Add `.pgraph/` to the repository's `.gitignore` before committing the local index.

Keep your first task in one selected project if you want a narrow investigation.
Workspace scope groups daily results from all detected projects; pinning a project
keeps its selection when editor focus changes. Workspace indexing and the relationship explorer have a separate
[workspace guide](WORKSPACE_GRAPH.md).

## Without an AI account

Open **PGraph: Daily Workflow** from the command palette or status bar. Pick the
entry matching the evidence you already have:

| Starting point                     | Action                                                          | Inspect before continuing                                                                              |
| ---------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| An exact error message             | **Find Exact Source Text**                                      | Matching source and its file/line. No match may mean an excluded, stale, external or unsupported file. |
| A stack trace                      | Select the trace in an editor, then **Investigate Stack Trace** | Resolved source locations and unresolved frames. Mapping a frame does not diagnose the cause.          |
| A source file                      | **Understand Current File**                                     | Its declarations, dependencies and consumers.                                                          |
| A function you are reading         | Put the cursor inside it and run **Context for Current Symbol** | Selected source and related symbols, including omissions.                                              |
| Your working changes               | **Show Changed Declarations**, then **Find Change Test Gaps**   | The comparison mode, changed declarations, candidate tests and unknown areas.                          |
| A removed API or changed signature | **Review Historical Impact**                                    | Before/after declarations, old/current consumer paths and explicit compatibility unknowns.             |

Reports contain paths and lines; open the matching file through VS Code's normal
file navigation. Confirm the evidence against the source. If a package check is
needed, use **Run Repository Check** and deliberately select the actual script to
execute. It runs repository code and package-manager lifecycle hooks. **Show
Recorded Checks** describes the result and freshness of supported inputs, not a
complete CI or correctness guarantee. Keep the project's required checks.

For an interruption, return to the source editor and **Save Investigation** with
your task. **Resume Investigation** resolves the saved symbol against fresh
evidence. Renamed or removed anchors may need to be saved again.

## With your existing agent

Index first, enable the PGraph tools in the host, and start with a concrete anchor.
For Copilot, reference `#pgraph_context` or `#pgraph_workflow` explicitly. For example:

In Workspace scope, start with `#pgraph_context` and ask the agent to carry each
returned `project` ID into follow-up queries. For a narrow investigation, pin the
project with **Choose Scope**, then use the exact-text workflow below.

> Use #pgraph_workflow to locate this exact error: “the error text”. Inspect the
> matching current source and explain what evidence is still missing. Start with
> a 1,500-token result; request more source only where needed.

The agent may need its ordinary editing, terminal or other tools to finish a task.
PGraph's deterministic queries make no model call. Your agent can send their output
to its configured model; it is not made local by using a local PGraph index.

For a smaller MCP discovery surface in the source build:

```sh
node packages/graph-mcp/dist/main.js /absolute/repository --tool-profile essential
```

This exposes six tools: `workflow`, `context`, `search`, `excerpt`, `file_slice`
and `impact`. Use `search` to resolve identifiers; request an explicit source range
when an excerpt omits needed code. Restart with `--tool-profile full` for other
queries such as dedicated callers or test paths. Full is the compatibility default.

In VS Code, the [optional user tool set](../examples/integrations/pgraph-essential.toolsets.jsonc)
groups the equivalent six extension tools. Add it through **Chat: Configure Tool
Sets**, then deselect other PGraph tools in the tools picker. Grouping alone does
not reduce the enabled set. This follows the documented [VS Code tool-set workflow](https://code.visualstudio.com/docs/agent-customization/tool-sets).
PGraph does not change your settings or agent instructions automatically.

## If the first result is not useful

| Symptom                   | Next step                                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Node cannot launch        | Set the full Node executable path from this computer in user settings.                                                                        |
| Index is missing or stale | Save the source, then run **Index Repository** or **Reindex Changed Files**.                                                                  |
| Index is slow or fails    | Read the named phase in PGraph Output; cancel if needed and narrow supported input scope. See [configuration](api.md#configuration).          |
| No text or symbol match   | Try a known identifier or cursor anchor; inspect ignored files and supported languages. Use normal editor search for files outside the index. |
| Result is truncated       | Narrow the query or request a bounded additional source range.                                                                                |
| Agent ignores the tools   | Check the host tools picker and make one explicit tool reference. Availability is different from automatic selection.                         |
| No static test path       | Inspect the package's normal checks. A missing graph path does not prove the code is untested.                                                |

If the workflow adds more steps than your usual tools, record the task and the
extra steps. The [pilot kit](USER_PILOT.md) describes how to compare usefulness
without counting clicks or token savings as proof of successful delivery.

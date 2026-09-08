# Changelog

## 0.1.0 — Unreleased

- Add an offline Cytoscape relationship explorer with workspace service maps,
  symbol drill-down, search, graph controls, evidence inspection and validated
  source navigation.
- Persist TypeScript/CommonJS HTTP and Azure messaging declarations, recognize
  v3 function.json and v4 registrations, and compose namespaced cross-root links
  using explicit URL/resource identities. Preserve ambiguous and unresolved targets.
- Add provider-independent topology/relationship APIs and bounded workspace composition.

- Add Index Workspace for all open microservice folders, per-folder results,
  sequential execution, idle worker release and removed-folder cleanup.
- Expose discovery/project/persistence progress for mixed TypeScript workspaces,
  with timestamped editor output for diagnosing slow configuration groups.

- Give large indexes a configurable 15-minute limit, retain separate query limits,
  queue engine requests so waiting queries cannot interrupt indexing, and show
  elapsed indexing time. Verify queued cancellation and recovery after timeouts.

- Explain missing Node executables with a machine-specific setup command and a Node
  Settings shortcut; distinguish moved workspace folders and verify retry recovery.

- Rename the product to PGraph by Praesidia, including the public API, CLI, packages,
  MCP identity, extension commands/settings/tools and local index paths. Add the
  connected-p logo, extension artwork and migration instructions.

- Implement local TypeScript/JavaScript graph indexing with SQLite persistence,
  transactional changed/deleted/renamed-file updates and checker-resolved calls.
- Add symbol queries, source slices, skeletons, impact and strict serialized BPE
  context budgets with deterministic ranking and representation selection.
- Add CLI, stdio MCP, VS Code sidebar/commands/Copilot tools, and explicitly enabled
  per-symbol Copilot semantic enrichment with separate provenance/invalidation.
- Add example applications, unit/integration/CLI/MCP/extension-host tests,
  retrieval and synthetic-scale benchmarks, threat model and release automation.
- Record remaining production acceptance gates explicitly; no unmeasured claim of
  coding-task correctness or hidden model-token savings.

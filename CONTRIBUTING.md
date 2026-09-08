# Contributing

Use Node 22.18+ (24 LTS preferred). Install with `npm ci --ignore-scripts`; indexing
never installs or runs a target repository's dependencies.

Before proposing a change:

```sh
npm run build
npm run check
npm run format:check
npm run test:coverage
npm run test:extension
```

For a local VS Code installation, set `PGRAPH_VSCODE_PATH` to its executable.
Otherwise the extension test runner downloads a test editor. Linux CI uses Xvfb.
The test profile and fixture workspace are isolated and deleted afterwards.

Keep Graph IR language-neutral and adapters thin. New edges need ownership,
provenance, confidence and incremental deletion tests. Never store redundant
reverse CALLS edges. Parameterize SQL. Treat source and semantic output as data.
Do not add telemetry, network access, repository execution or a mandatory AI service.

For retrieval changes, run both benchmark suites and compare required-symbol recall
as well as token counts. A reduction that loses required context is a regression.
Use paired agent trials to support correctness claims; do not relabel recall as
task correctness. Add representative fixtures for new language/framework behavior.

Packages use semantic versioning. Breaking IR/schema/API changes need a migration,
release note and compatibility plan. Avoid destructive cache migrations. The
release workflow prepares artifacts; publishing requires a maintainer to review
the acceptance gates in ROADMAP.md and configure repository/registry identities.

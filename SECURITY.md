# Security policy

PGraph analyzes untrusted repositories using trusted installed tooling. Its core
does not run repository scripts, compiler plugins, application imports or model
requests. Source/indexes remain local until an authorized consumer reads tool output
or the user explicitly invokes Copilot enrichment.

Security invariants:

- Source reads must remain within the selected real repository root, reject symlinks
  and validate indexed hashes before returning live ranges.
- MCP query clients cannot select another root, execute programs, mutate the graph
  through tools, or start semantic enrichment.
- Source comments and model responses are untrusted data. Inferred facts must retain
  provenance and may not overwrite deterministic compiler edges.
- Work and output must be bounded. Invalid configuration, corrupt indexes, stale
  source and incompatible schemas must fail visibly rather than fabricate answers.
- New `.pgraph` directories request private permissions. Do not share graph caches
  or place them in public directories: signatures and metadata can contain sensitive
  information. Filename exclusions are not universal secret detection.

The separate editor process provides responsiveness and cancellation, not an OS
sandbox. Stdio clients inherit the authority of their launcher. Do not expose the
server publicly, ingest untrusted graph databases, or treat semantic assertions as
instructions. Stop active clients before deleting local index artifacts.

See [the source-backed threat model](docs/THREAT_MODEL.md) for boundaries, effective
resources, hypotheses and residual risks. No independent penetration-test claim is
made. Supported security-fix line: 0.1.x while this project is in pre-release.

Report vulnerabilities through the repository host's private security-advisory
channel once this checkout is published, or an established private maintainer
channel. Do not include live secrets or post exploitable details in public issues.
The final hosting identity/contact must be set by maintainers before public release.

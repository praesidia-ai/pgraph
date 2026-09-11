import { RelationshipExplorer } from "../apps/vscode-extension/src/explorer.js";
import type {
  ExplorerGraph,
  RepositoryTopology,
  WorkspaceImpactResult,
} from "@praesidia/pgraph-core";
import * as vscode from "vscode";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { EngineClient } from "../apps/vscode-extension/src/client.js";

export async function run(): Promise<void> {
  await vscode.workspace
    .getConfiguration("pgraph")
    .update(
      "nodePath",
      process.env.PGRAPH_TEST_NODE,
      vscode.ConfigurationTarget.Global,
    );
  await vscode.workspace
    .getConfiguration("pgraph")
    .update("autoIndex", false, vscode.ConfigurationTarget.Global);
  assert.equal(
    vscode.workspace.workspaceFolders?.length,
    2,
    "Test two open microservice repositories",
  );
  const fixtureManifest = join(
    vscode.workspace.workspaceFolders![0]!.uri.fsPath,
    "package.json",
  );
  const fixturePackage = JSON.parse(readFileSync(fixtureManifest, "utf8"));
  fixturePackage.packageManager = "npm@10.0.0";
  const fixtureNode = `'${process.env.PGRAPH_TEST_NODE!.replaceAll("'", "'\\''")}'`;
  fixturePackage.scripts = {
    ...fixturePackage.scripts,
    "test:pgraph-fixture": `${fixtureNode} -e 'process.exit(0)'`,
  };
  writeFileSync(
    fixtureManifest,
    JSON.stringify(fixturePackage, null, 2) + "\n",
  );
  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders![0]!.uri,
        "src/auth.service.ts",
      ),
    ),
  );
  const extension = vscode.extensions.getExtension("praesidia.pgraph");
  assert.ok(extension, "Development extension is present");
  const api = (await extension.activate()) as {
    request: (name: string, input: unknown) => Promise<string>;
    projects: () => { name: string; root: string }[];
  };
  await vscode.commands.executeCommand(
    "pgraph.chooseScope",
    vscode.workspace.workspaceFolders![0]!.uri.toString(),
  );
  // Reproduce a machine whose editor cannot find Node, then recover without reload.
  await vscode.workspace
    .getConfiguration("pgraph")
    .update(
      "nodePath",
      vscode.Uri.joinPath(extension.extensionUri, "missing-node-executable")
        .fsPath,
      vscode.ConfigurationTarget.Global,
    );
  await assert.rejects(api.request("status", {}), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /VS Code cannot find Node\.js/);
    assert.ok(error.message.includes('node -p "process.execPath"'));
    return true;
  });
  await vscode.workspace
    .getConfiguration("pgraph")
    .update(
      "nodePath",
      process.env.PGRAPH_TEST_NODE,
      vscode.ConfigurationTarget.Global,
    );
  const indexed = await vscode.commands.executeCommand<{ nodes: number }>(
    "pgraph.index",
  );
  assert.ok(indexed && indexed.nodes > 30, "Real worker indexed fixture");
  const naturalContext = JSON.parse(
    await api.request("context", {
      task: "Why are expired sessions removed while looking up a token?",
      maxTokens: 1400,
      format: "json",
    }),
  );
  assert.ok(
    naturalContext.symbols.some(
      (item: { symbol: string; text: string }) =>
        item.symbol === "TokenService.resolve" &&
        item.text.includes("expiresAt"),
    ),
    "Bundled worker supplies implementation for a natural-language task",
  );
  assert.ok(
    naturalContext.estimatedTokens <= 1400,
    "Natural task respects its total budget",
  );
  const symbol = JSON.parse(
    await api.request("symbol", { symbol: "AuthService.login" }),
  );
  assert.equal(symbol.symbol, "AuthService.login");
  const focusedDocument = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(
      vscode.workspace.workspaceFolders![0]!.uri,
      "src/auth.service.ts",
    ),
  );
  await vscode.window.showTextDocument(focusedDocument, {
    selection: new vscode.Range(10, 0, 10, 0),
  });
  const focused = await vscode.commands.executeCommand<string>(
    "pgraph.contextHere",
    "Explain this login implementation",
  );
  assert.ok(
    focused?.includes("editor focus") && focused.includes("AuthService.login"),
  );
  const modelFacts = await vscode.lm.invokeTool(
    "pgraph_context",
    {
      input: {
        task: "AuthService.login",
        evidenceMode: "assisted",
        maxTokens: 1500,
      },
      toolInvocationToken: undefined,
    },
    new vscode.CancellationTokenSource().token,
  );
  assert.ok(
    modelFacts.content.some(
      (part) =>
        part instanceof vscode.LanguageModelTextPart &&
        part.value.includes("Evidence: local"),
    ),
    "Local editor preference overrides model evidence requests",
  );
  const retainedInput = {
    task: "Change AuthService.login validation",
    format: "json",
    maxTokens: 2000,
  };
  const retained = JSON.parse(await api.request("context", retainedInput));
  const followup = await vscode.lm.invokeTool(
    "pgraph_context",
    {
      input: { ...retainedInput, previousContextId: retained.contextId },
      toolInvocationToken: undefined,
    },
    new vscode.CancellationTokenSource().token,
  );
  const followupText = followup.content.find(
    (part) => part instanceof vscode.LanguageModelTextPart,
  ) as vscode.LanguageModelTextPart;
  assert.equal(
    JSON.parse(followupText.value).reuseFrom,
    retained.contextId,
    "Agent tool reuses retained context",
  );
  const excerpt = await vscode.lm.invokeTool(
    "pgraph_excerpt",
    {
      input: {
        symbol: "AuthService.login",
        query: "password",
        maxLines: 10,
        maxTokens: 1000,
      },
      toolInvocationToken: undefined,
    },
    new vscode.CancellationTokenSource().token,
  );
  const excerptText = excerpt.content.find(
    (part) => part instanceof vscode.LanguageModelTextPart,
  ) as vscode.LanguageModelTextPart;
  assert.ok(
    JSON.parse(excerptText.value).source,
    "Registered excerpt tool returns actual source",
  );
  const daily = await vscode.lm.invokeTool(
    "pgraph_workflow",
    {
      input: { action: "text", query: "password", maxTokens: 1000 },
      toolInvocationToken: undefined,
    },
    new vscode.CancellationTokenSource().token,
  );
  assert.ok(
    daily.content.some(
      (part) =>
        part instanceof vscode.LanguageModelTextPart &&
        part.value.includes("matches"),
    ),
    "Daily workflow is registered for agents",
  );
  const health = JSON.parse(
    (await vscode.commands.executeCommand<string>("pgraph.health"))!,
  );
  assert.equal(health.current, true);
  assert.ok(
    vscode.window.activeTextEditor?.document
      .getText()
      .includes("Index freshness"),
    "Human-readable daily report opens",
  );
  await vscode.window.showTextDocument(focusedDocument, {
    selection: new vscode.Range(10, 0, 10, 0),
  });
  const bookmark = await vscode.commands.executeCommand<{
    id: string;
    symbol: string;
  }>("pgraph.saveInvestigation", "Investigate login validation");
  assert.ok(bookmark?.symbol.includes("AuthService.login"));
  const resumed = await vscode.commands.executeCommand<string>(
    "pgraph.resumeInvestigation",
    bookmark.id,
  );
  assert.ok(resumed?.includes("AuthService.login"));
  await vscode.commands.executeCommand(
    "pgraph.removeInvestigation",
    bookmark.id,
  );
  const checkResult = await vscode.commands.executeCommand<{
    result: string;
    exitCode: number;
    inputsChangedDuringRun: boolean;
  }>("pgraph.runCheck", "package.json#test:pgraph-fixture");
  assert.equal(
    checkResult?.result,
    "passed",
    "Actual VS Code task reports the fixture exit status",
  );
  assert.equal(checkResult.inputsChangedDuringRun, false);
  const verification = JSON.parse(
    await api.request("workflow", { action: "verification", maxTokens: 2000 }),
  );
  assert.equal(verification.runs[0].freshness, "tracked inputs current");
  const result = await vscode.lm.invokeTool(
    "pgraph_callers",
    {
      input: { symbol: "AuthService.login", maxTokens: 1000 },
      toolInvocationToken: undefined,
    },
    new vscode.CancellationTokenSource().token,
  );
  assert.ok(
    result.content.some(
      (part) =>
        part instanceof vscode.LanguageModelTextPart &&
        part.value.includes("AuthController.login"),
    ),
    "Registered LM tool invokes worker",
  );
  await vscode.commands.executeCommand(
    "pgraph.context",
    "Add account lockout to login",
  );
  assert.ok(
    vscode.window.activeTextEditor?.document
      .getText()
      .includes("PGraph context"),
    "Context opens in actual editor",
  );
  const savings = await vscode.commands.executeCommand<{
    contextTokens: number;
  }>("pgraph.savings");
  assert.ok(savings && savings.contextTokens > 0);
  assert.ok(vscode.lm.tools.some((t) => t.name === "pgraph_context"));
  const noChange = await vscode.commands.executeCommand<{ parsed: number }>(
    "pgraph.reindex",
  );
  assert.equal(noChange?.parsed, 0);
  const reviewRoot = vscode.workspace.workspaceFolders![0]!.uri.fsPath;
  const priorRevision = JSON.parse(await api.request("status", {})).revision;
  await vscode.workspace
    .getConfiguration("pgraph")
    .update("autoIndex", true, vscode.ConfigurationTarget.Global);
  try {
    writeFileSync(
      join(reviewRoot, "yarn.lock"),
      "# fixture dependency change\n",
    );
    let revision = priorRevision;
    const deadline = Date.now() + 10000;
    while (revision === priorRevision && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      revision = JSON.parse(await api.request("status", {})).revision;
    }
    assert.ok(revision > priorRevision, "Lockfile watcher refreshes the index");
  } finally {
    await vscode.workspace
      .getConfiguration("pgraph")
      .update("autoIndex", false, vscode.ConfigurationTarget.Global);
  }
  const git = (args: string[]) =>
    execFileSync("git", ["-C", reviewRoot, ...args], { stdio: "ignore" });
  git(["init"]);
  writeFileSync(join(reviewRoot, ".gitignore"), ".pgraph/\n");
  git(["add", "."]);
  git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "fixture",
  ]);
  await vscode.window.showTextDocument(focusedDocument);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(
    focusedDocument.uri,
    new vscode.Position(focusedDocument.lineCount, 0),
    "\n// change review fixture\n",
  );
  await vscode.workspace.applyEdit(edit);
  await focusedDocument.save();
  const review = await vscode.commands.executeCommand<{
    totalFiles: number;
    tests: unknown[];
  }>("pgraph.reviewChanges");
  assert.equal(review?.totalFiles, 1);
  assert.ok(review.tests.length > 0);
  const historicalFile = join(reviewRoot, "src/token.service.ts");
  const historicalSource = readFileSync(historicalFile, "utf8");
  const withoutRevoke = historicalSource.replace(
    /  revoke\(token: string\): void \{\n    this\.sessions\.delete\(token\);\n  \}\n/,
    "",
  );
  assert.notEqual(
    withoutRevoke,
    historicalSource,
    "Remove a real called method from the fixture",
  );
  try {
    writeFileSync(
      historicalFile,
      withoutRevoke +
        "\n" +
        Array.from(
          { length: 150 },
          (_, i) =>
            `export function historyPage${i}(): number { return ${i}; }`,
        ).join("\n"),
    );
    await vscode.commands.executeCommand("pgraph.index");
    const historicalText = await vscode.commands.executeCommand<string>(
      "pgraph.historicalChanges",
      "working",
    );
    const historical = JSON.parse(historicalText!);
    const removed = historical.changes.find(
      (change: { before?: { symbol: string } }) =>
        change.before?.symbol === "TokenService.revoke",
    );
    assert.equal(removed?.change, "removed");
    assert.ok(
      removed.consumers.some(
        (consumer: { node: { symbol: string }; snapshot: string }) =>
          consumer.node.symbol === "AuthService.logout" &&
          consumer.snapshot === "before",
      ),
      "Historical editor review recovers a consumer missing from the current graph",
    );
    assert.ok(
      vscode.window.activeTextEditor?.document
        .getText()
        .includes("Historical change impact"),
    );
    assert.ok(
      historical.page.nextOffset > 0,
      "The editor offers more historical rows after output packing",
    );
    const continuedText = await vscode.commands.executeCommand<string>(
      "pgraph.continueHistoricalChanges",
      vscode.Uri.file(reviewRoot).toString(),
    );
    const continued = JSON.parse(continuedText!);
    assert.equal(continued.page.reviewId, historical.page.reviewId);
    assert.equal(continued.page.offset, historical.page.nextOffset);
    const priorIds = new Set(
      historical.changes.map(
        (change: { before?: { id: string }; after?: { id: string } }) =>
          (change.before ?? change.after)!.id,
      ),
    );
    assert.ok(
      continued.changes.every(
        (change: { before?: { id: string }; after?: { id: string } }) =>
          !priorIds.has((change.before ?? change.after)!.id),
      ),
      "Continuation advances without repeating visible declarations",
    );
  } finally {
    writeFileSync(historicalFile, historicalSource);
    await vscode.commands.executeCommand("pgraph.index");
  }
  const [workspaceResult, duplicateRun] = await Promise.all([
    vscode.commands.executeCommand<{
      indexed: number;
      failed: number;
      roots: { result?: { nodes: number } }[];
    }>("pgraph.indexWorkspace"),
    vscode.commands.executeCommand("pgraph.indexWorkspace"),
  ]);
  assert.deepEqual(
    duplicateRun,
    workspaceResult,
    "Repeated workspace commands share the current run",
  );
  assert.equal(workspaceResult?.indexed, 2);
  assert.equal(workspaceResult?.failed, 0);
  assert.ok(
    workspaceResult.roots.every((root) => root.result && root.result.nodes > 0),
  );
  for (const folder of vscode.workspace.workspaceFolders!)
    assert.ok(
      existsSync(join(folder.uri.fsPath, ".pgraph/graph.db")),
      "Every open root has its own persistent graph",
    );
  const afterRelease = JSON.parse(
    await api.request("symbol", { symbol: "AuthService.login" }),
  );
  assert.equal(
    afterRelease.symbol,
    "AuthService.login",
    "Released workers restart for later queries",
  );
  const explorerOutput = vscode.window.createOutputChannel(
    "PGraph explorer test",
  );
  const explorerEngine = new EngineClient(
    vscode.workspace.workspaceFolders![0]!.uri.fsPath,
    extension.extensionUri.fsPath + "/dist/worker.cjs",
    explorerOutput,
  );
  const snapshot = await explorerEngine.request<RepositoryTopology>("topology");
  const neighborhood = await explorerEngine.request<ExplorerGraph>(
    "relationships",
    { query: "AuthService", depth: 1 },
  );
  assert.ok(neighborhood.nodes.length > 0);
  const navigated: string[] = [];
  const panel = new RelationshipExplorer(extension.extensionUri, {
    workspace: async () => neighborhood,
    relationships: async (rootId, options) => {
      assert.equal(rootId, snapshot.rootId);
      return explorerEngine.request<ExplorerGraph>("relationships", options);
    },
    open: async (rootId, symbol, revision, line) => {
      assert.equal(rootId, snapshot.rootId);
      const location = await explorerEngine.request<{ path: string }>(
        "sourceLocation",
        { symbol, revision, line },
      );
      navigated.push(location.path);
    },
  });
  try {
    assert.ok(panel.panel.webview.html.includes("default-src 'none'"));
    assert.ok(panel.panel.webview.html.includes("media/explorer.css"));
    await panel.handle({ type: "ready" });
    const node = neighborhood.nodes.find((n) => n.symbolId && n.location)!;
    await panel.handle({ type: "open", id: node.id });
    assert.equal(navigated.length, 1);
    await assert.rejects(
      panel.handle({ type: "open", id: "../../.ssh/id_rsa" }),
      /not in the displayed graph/,
    );
    await assert.rejects(
      panel.handle({ type: "focus", id: "unknown-root" }),
      /not in the displayed graph/,
    );
    await assert.rejects(
      panel.handle({ type: "execute", command: "anything" }),
      /Unknown explorer action/,
    );
    await assert.rejects(
      explorerEngine.request("sourceLocation", {
        symbol: node.symbolId,
        revision: -1,
      }),
      /Index changed/,
    );
    await panel.handle({ type: "focus", id: node.id });
    await panel.handle({
      type: "search",
      query: "AuthService",
      direction: "both",
      depth: 2,
    });
    panel.markStale();
  } finally {
    panel.dispose();
    explorerEngine.dispose();
    explorerOutput.dispose();
  }
  await vscode.commands.executeCommand("pgraph.explore");
  assert.ok(
    vscode.window.tabGroups.all.some((group) =>
      group.tabs.some((tab) => tab.input instanceof vscode.TabInputWebview),
    ),
    "Explore Relationships opens a real webview",
  );
  // A folder like frontier contains repositories but has no Git history itself.
  const containerRoot = mkdtempSync(join(tmpdir(), "pgraph-container-"));
  const containerUri = vscode.Uri.file(containerRoot);
  const childA = join(containerRoot, "service-a"),
    childB = join(containerRoot, "service-b");
  try {
    for (const child of [childA, childB]) {
      mkdirSync(child);
      writeFileSync(
        join(child, "package.json"),
        JSON.stringify({
          name: child === childA ? "service-a" : "service-b",
          scripts: { test: "node -e 'process.exit(0)'" },
        }),
      );
      writeFileSync(
        join(child, "index.ts"),
        `export function childMarker() { return 'workspace-child-marker-${child === childA ? "a" : "b"}'; }\n`,
      );
      writeFileSync(join(child, ".gitignore"), ".pgraph/\n");
      writeFileSync(
        join(child, ".pgraph.json"),
        JSON.stringify({
          topology: {
            services: [
              {
                name:
                  child === childA ? "workspace-client" : "workspace-receiver",
                path: ".",
                resources: { BUS: "workspace/namespace" },
                channels:
                  child === childA
                    ? { OUT_QUEUE: "workspace-queue" }
                    : { IN_QUEUE: "workspace-queue" },
                ...(child === childA
                  ? { urls: { WORKSPACE_API: "https://workspace.internal" } }
                  : { origins: ["https://workspace.internal"] }),
              },
            ],
          },
        }),
      );
      writeFileSync(
        join(child, "workspace-impact.ts"),
        child === childA
          ? "export function sendWorkspace(){return fetch(`${process.env.WORKSPACE_API}/api/receive`);}\nimport {ServiceBusClient} from '@azure/service-bus';const connection=process.env.BUS;const client=new ServiceBusClient(connection);const queue=process.env.OUT_QUEUE??'fallback';const sender=client.createSender(queue);\nexport function sendQueuedWorkspace(){return sender.scheduleMessages({body:1},new Date());}\n"
          : "import {app} from '@azure/functions';\nexport function storeWorkspace(){return 'stored-workspace-message';}\nexport function receiveWorkspace(){return storeWorkspace();}\napp.http('receive',{methods:['GET'],handler:receiveWorkspace});\nconst shared={handler:receiveWorkspace} as const;app.serviceBusQueue('queued',{...shared,connection:'BUS',queueName:'%IN_QUEUE%'} as any);\n",
      );
      if (child === childA) {
        mkdirSync(join(child, "shared/src"), { recursive: true });
        writeFileSync(
          join(child, "tsconfig.json"),
          JSON.stringify({
            compilerOptions: { module: "NodeNext" },
            references: [{ path: "./shared" }],
          }),
        );
        writeFileSync(
          join(child, "shared/tsconfig.json"),
          JSON.stringify({
            compilerOptions: {
              composite: true,
              rootDir: "src",
              outDir: "dist",
              module: "NodeNext",
            },
          }),
        );
        writeFileSync(
          join(child, "shared/package.json"),
          JSON.stringify({
            name: "@fixture/shared",
            exports: {
              ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
            },
          }),
        );
        writeFileSync(
          join(child, "shared/src/index.ts"),
          "export function sharedDelivery(){ return 1; }\n",
        );
        writeFileSync(
          join(child, "index.ts"),
          "import {sharedDelivery} from '@fixture/shared'; export function childMarker(){ sharedDelivery(); return 'workspace-child-marker-a'; }\n",
        );
      }
      execFileSync("git", ["-C", child, "init"], { stdio: "ignore" });
    }
    execFileSync("git", ["-C", childA, "add", "."], { stdio: "ignore" });
    execFileSync(
      "git",
      [
        "-C",
        childA,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-m",
        "fixture",
      ],
      { stdio: "ignore" },
    );
    assert.equal(
      vscode.workspace.updateWorkspaceFolders(
        vscode.workspace.workspaceFolders!.length,
        0,
        { uri: containerUri },
      ),
      true,
    );
    const deadline = Date.now() + 5000;
    while (
      !vscode.workspace.getWorkspaceFolder(containerUri) &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 50));
    const detected = await vscode.commands.executeCommand<
      { name: string; root: string }[]
    >("pgraph.refreshProjects");
    assert.equal(
      detected?.length,
      4,
      "Two open projects plus two children from the container",
    );
    assert.ok(!detected.some((p) => p.root === containerUri.toString()));
    await vscode.commands.executeCommand("pgraph.chooseScope", "workspace");
    const indexed = await vscode.commands.executeCommand<{
      indexed: number;
      failed: number;
    }>("pgraph.indexWorkspace");
    assert.equal(indexed?.indexed, 4);
    assert.equal(indexed.failed, 0);
    assert.equal(
      existsSync(join(containerRoot, ".pgraph")),
      false,
      "Do not create a parent-container index",
    );
    const workspaceResult = await vscode.lm.invokeTool(
      "pgraph_context",
      {
        input: { task: "childMarker", maxTokens: 4000, format: "json" },
        toolInvocationToken: undefined,
      },
      new vscode.CancellationTokenSource().token,
    );
    const workspaceText = workspaceResult.content.find(
      (p) => p instanceof vscode.LanguageModelTextPart,
    ) as vscode.LanguageModelTextPart;
    const workspaceContext = JSON.parse(workspaceText.value);
    assert.equal(workspaceContext.scope, "workspace");
    assert.equal(workspaceContext.projects.length, 4);
    const childContexts = workspaceContext.projects.filter(
      (p: { name: string }) => /service-[ab]$/.test(p.name),
    );
    assert.equal(childContexts.length, 2);
    const originProject = childContexts.find((p: { name: string }) =>
      p.name.endsWith("service-a"),
    ).project;
    const impactResult = await vscode.lm.invokeTool(
      "pgraph_impact",
      {
        input: {
          workspace: true,
          project: originProject,
          symbol: "sendWorkspace",
          maxTokens: 6000,
        },
        toolInvocationToken: undefined,
      },
      new vscode.CancellationTokenSource().token,
    );
    const impact = JSON.parse(
      (
        impactResult.content.find(
          (p) => p instanceof vscode.LanguageModelTextPart,
        ) as vscode.LanguageModelTextPart
      ).value,
    ) as WorkspaceImpactResult;
    assert.equal(impact.analysis, "workspace-static-impact");
    assert.equal(impact.projects.length, 4);
    assert.ok(
      impact.paths.some((path) =>
        path.steps.some((step) => step.type === "http"),
      ),
    );
    const remote = impact.symbols.find(
      (symbol) => symbol.name === "storeWorkspace",
    );
    assert.ok(
      remote,
      "Workspace impact reaches the receiving service's implementation",
    );
    assert.notEqual(remote.project, originProject);
    assert.ok(
      (
        await api.request("slice", {
          project: remote.project,
          symbol: remote.symbol,
        })
      ).includes("stored-workspace-message"),
    );
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(
        vscode.Uri.file(join(childA, "workspace-impact.ts")),
      ),
      { selection: new vscode.Range(0, 0, 0, 0) },
    );
    const nativeImpact = JSON.parse(
      (await vscode.commands.executeCommand<string>(
        "pgraph.workspaceImpactHere",
      ))!,
    ) as WorkspaceImpactResult;
    assert.ok(
      nativeImpact.symbols.some((symbol) => symbol.name === "storeWorkspace"),
      JSON.stringify(nativeImpact),
    );
    const queuedImpact = JSON.parse(
      await api.request("impact", {
        workspace: true,
        project: originProject,
        symbol: "sendQueuedWorkspace",
        maxTokens: 6000,
      }),
    ) as WorkspaceImpactResult;
    assert.ok(
      queuedImpact.paths.some((path) =>
        path.steps.some((step) => step.type === "service-bus"),
      ),
      "Scheduled sends and typed binding options use explicit channel mappings",
    );
    const mappings = JSON.parse(
      await api.request("workflow", {
        project: originProject,
        action: "connections",
        maxTokens: 4000,
      }),
    );
    assert.ok(
      mappings.requirements.some(
        (row: { configuration: string; status: string }) =>
          row.configuration === "channels.OUT_QUEUE" &&
          row.status === "configured",
      ),
    );
    const nativeMappings = JSON.parse(
      (await vscode.commands.executeCommand<string>("pgraph.connections"))!,
    );
    assert.equal(nativeMappings.scope, "workspace");
    assert.equal(nativeMappings.projects.length, 4);
    assert.ok(
      vscode.window.activeTextEditor?.document
        .getText()
        .includes("Connection mapping readiness"),
    );
    await assert.rejects(
      api.request("impact", { workspace: true, symbol: "sendWorkspace" }),
      /origin project ID/,
    );
    await assert.rejects(
      api.request("impact", {
        workspace: true,
        project: originProject,
        symbol: "sendWorkspace",
        roots: [containerRoot],
      }),
      /Unrecognized key/,
    );
    for (const project of childContexts) {
      const symbol = project.symbols.find(
        (s: { symbol: string }) => s.symbol === "childMarker",
      );
      assert.ok(
        symbol?.sourceHash,
        "Workspace context retains verified source identity",
      );
      const follow = await vscode.lm.invokeTool(
        "pgraph_slice",
        {
          input: {
            project: project.project,
            symbol: symbol.id,
            maxTokens: 1000,
          },
          toolInvocationToken: undefined,
        },
        new vscode.CancellationTokenSource().token,
      );
      assert.ok(
        JSON.stringify(follow.content).includes(
          project.name.endsWith("service-a")
            ? "workspace-child-marker-a"
            : "workspace-child-marker-b",
        ),
      );
      if (project.name.endsWith("service-a"))
        assert.ok(
          (
            await api.request("callees", {
              project: project.project,
              symbol: "childMarker",
            })
          ).includes("sharedDelivery"),
          "Agent follows a local referenced package to its unbuilt source",
        );
    }
    await assert.rejects(
      api.request("context", {
        task: "childMarker",
        focus: { file: "index.ts", line: 1 },
      }),
      /project ID/,
    );
    await assert.rejects(
      api.request("slice", { project: "f".repeat(24), symbol: "childMarker" }),
      /Unknown or closed project/,
    );
    writeFileSync(
      join(childB, "index.ts"),
      "export function childMarker() { return 'edited-after-index'; }\n",
    );
    const partialImpact = JSON.parse(
      await api.request("impact", {
        workspace: true,
        project: originProject,
        symbol: "sendWorkspace",
        maxTokens: 6000,
      }),
    ) as WorkspaceImpactResult;
    assert.ok(
      partialImpact.projects.some(
        (project) =>
          project.name.endsWith("service-b") &&
          project.error?.includes("stale"),
      ),
    );
    assert.ok(
      !partialImpact.symbols.some((symbol) => symbol.name === "storeWorkspace"),
      "Stale service paths are never returned as current evidence",
    );
    const staleWorkspace = JSON.parse(
      await api.request("context", {
        task: "childMarker",
        format: "json",
        maxTokens: 4000,
      }),
    );
    assert.ok(
      staleWorkspace.projects.some(
        (p: { name: string; error?: string }) =>
          p.name.endsWith("service-b") && p.error?.includes("Stale"),
      ),
    );
    assert.ok(
      staleWorkspace.projects.some(
        (p: { name: string; symbols: unknown[] }) =>
          p.name.endsWith("service-a") && p.symbols.length,
      ),
    );
    writeFileSync(
      join(childB, "index.ts"),
      "export function childMarker() { return 'workspace-child-marker-b'; }\n",
    );
    const text = JSON.parse(
      (await vscode.commands.executeCommand<string>(
        "pgraph.searchText",
        "workspace-child-marker",
      ))!,
    );
    assert.equal(text.scope, "workspace");
    assert.equal(text.projects.length, 4);
    assert.equal(
      text.projects.filter(
        (p: { data?: { matches?: unknown[] } }) => p.data?.matches?.length,
      ).length,
      2,
    );
    const changed = JSON.parse(
      (await vscode.commands.executeCommand<string>(
        "pgraph.changedDeclarations",
      ))!,
    );
    assert.equal(changed.projects.length, 4);
    assert.ok(
      changed.projects.some(
        (p: { root: string; error?: string }) =>
          p.root === vscode.Uri.file(childB).toString() &&
          p.error?.includes("initial commit"),
      ),
    );
    assert.ok(
      changed.projects.some(
        (p: { root: string; data?: unknown }) =>
          p.root === vscode.Uri.file(childA).toString() && p.data,
      ),
    );
    const childDoc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(join(childA, "index.ts")),
    );
    await vscode.window.showTextDocument(childDoc);
    const file = JSON.parse(
      (await vscode.commands.executeCommand<string>("pgraph.fileOverview"))!,
    );
    assert.equal(
      file.file,
      "index.ts",
      "Cursor file is relative to its child project, not the container",
    );
    await vscode.window.showTextDocument(childDoc);
    const saved = await vscode.commands.executeCommand<{
      id: string;
      symbol?: string;
    }>("pgraph.saveInvestigation", "Resume child source");
    assert.ok(saved?.symbol?.includes("childMarker"));
    const resumedChild = await vscode.commands.executeCommand<string>(
      "pgraph.resumeInvestigation",
      saved.id,
    );
    assert.ok(resumedChild?.includes("childMarker"));
    await vscode.commands.executeCommand(
      "pgraph.removeInvestigation",
      saved.id,
    );
    await vscode.commands.executeCommand(
      "pgraph.chooseScope",
      vscode.Uri.file(childA).toString(),
    );
    await vscode.window.showTextDocument(focusedDocument);
    const pinned = JSON.parse(
      await api.request("symbol", { symbol: "childMarker" }),
    );
    assert.equal(
      pinned.symbol,
      "childMarker",
      "Pinned project survives focus moving to another project",
    );
  } finally {
    const position =
      vscode.workspace.workspaceFolders?.findIndex(
        (f) => f.uri.toString() === containerUri.toString(),
      ) ?? -1;
    if (position >= 0) vscode.workspace.updateWorkspaceFolders(position, 1);
    const deadline = Date.now() + 5000;
    while (
      vscode.workspace.getWorkspaceFolder(containerUri) &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 50));
    await vscode.commands.executeCommand(
      "pgraph.chooseScope",
      vscode.workspace.workspaceFolders![0]!.uri.toString(),
    );
    rmSync(containerRoot, { recursive: true, force: true });
  }
  const testRoot = mkdtempSync(join(tmpdir(), "pgraph-timeouts-"));
  const worker = join(testRoot, "worker.cjs");
  writeFileSync(
    worker,
    `process.on("message", m => {
    if (m.op === "index") process.send({id: m.id, progress: {phase: "analyze", message: "Analyzing fixture"}});
    setTimeout(() => process.send({ id: m.id, result: m.op }), m.op === "index" ? 3200 : (m.args.delay || 0));
  });`,
  );
  const output = vscode.window.createOutputChannel("PGraph timeout test");
  const queuedClient = new EngineClient(testRoot, worker, output);
  const queuedCancellation = new vscode.CancellationTokenSource();
  try {
    await vscode.workspace
      .getConfiguration("pgraph")
      .update("indexTimeoutSeconds", 10, vscode.ConfigurationTarget.Global);
    await vscode.workspace
      .getConfiguration("pgraph")
      .update("queryTimeoutSeconds", 2, vscode.ConfigurationTarget.Global);
    const phases: string[] = [];
    const indexing = queuedClient.request("index", {}, undefined, (update) =>
      phases.push(update.message),
    );
    const waitingQuery = queuedClient.request("tool");
    const cancelled = queuedClient.request(
      "tool",
      {},
      queuedCancellation.token,
    );
    queuedCancellation.cancel();
    await assert.rejects(
      cancelled,
      (error) => error instanceof vscode.CancellationError,
    );
    assert.equal(await indexing, "index");
    assert.deepEqual(
      phases,
      ["Analyzing fixture"],
      "Progress must not resolve the request before indexing completes",
    );
    assert.equal(
      await waitingQuery,
      "tool",
      "A queued query must survive waiting longer than its execution timeout",
    );
    await assert.rejects(
      queuedClient.request("tool", { delay: 4000 }),
      /query exceeded 2 seconds/,
    );
    assert.equal(
      await queuedClient.request("tool"),
      "tool",
      "Worker restarts after a real timeout",
    );
  } finally {
    queuedClient.dispose();
    queuedCancellation.dispose();
    output.dispose();
    rmSync(testRoot, { recursive: true, force: true });
    await vscode.workspace
      .getConfiguration("pgraph")
      .update(
        "indexTimeoutSeconds",
        undefined,
        vscode.ConfigurationTarget.Global,
      );
    await vscode.workspace
      .getConfiguration("pgraph")
      .update(
        "queryTimeoutSeconds",
        undefined,
        vscode.ConfigurationTarget.Global,
      );
  }
  console.log(
    "PGraph extension-host workflow passed: relationship webview, graph worker, validated navigation, message rejection, multi-root indexing, per-project progress, long indexing, queued query/cancellation, timeout recovery, missing Node recovery, activation, sidebar, indexing, LM tool, context document, metrics, incremental update.",
  );
}

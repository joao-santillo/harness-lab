import { expect, test } from "@playwright/test";

test("validates the connection workflow and localized navigation without overflow", async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  let submittedConnection: Record<string, unknown> | null = null;
  await page.route("**/api/v1/connections", async (route) => {
    submittedConnection = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "connection-e2e", configured: true }) });
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Conexões de agentes" })).toBeVisible();
  await page.getByRole("button", { name: "Salvar conexão" }).click();
  await expect(page.getByRole("alert")).toContainText("Preencha todos os campos obrigatórios");
  await page.getByLabel("Nome da conexão").fill("Principal");
  await page.getByLabel("URL base").fill("https://langfuse.example");
  await page.getByLabel("Chave pública").fill("pk-test");
  await page.getByLabel("Chave secreta").fill("sk-private");
  await expect(page.getByLabel("Chave secreta")).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Salvar conexão" }).click();
  await expect(page.getByRole("status")).toContainText("Conexão salva com segurança");
  expect(submittedConnection).toMatchObject({
    kind: "langfuse",
    credentials: { baseUrl: "https://langfuse.example", publicKey: "pk-test", secretKey: "sk-private" },
  });
  await expect(page.getByLabel("Chave secreta")).toHaveValue("");
  await page.getByLabel("Idioma").selectOption("en");
  await page.getByRole("tab", { name: "Rounds" }).click();
  await expect(page.getByRole("heading", { name: "Rounds" })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
  expect(browserErrors).toEqual([]);
  await page.screenshot({ path: `test-results/${testInfo.project.name}.png`, fullPage: true });
});

test("registers Agent Platform with a token field and no Langfuse keys", async ({ page }, testInfo) => {
  let submittedConnection: Record<string, unknown> | null = null;
  await page.route("**/api/v1/connections", async (route) => {
    submittedConnection = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "platform-e2e", configured: true }) });
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Integração").selectOption("agent-platform");
  await expect(page.getByLabel("Token da Agent Platform")).toBeVisible();
  await expect(page.getByLabel("Chave pública")).toHaveCount(0);
  await page.getByLabel("Nome da conexão").fill("Plataforma principal");
  await page.getByLabel("URL base").fill("https://platform.example");
  await page.getByLabel("Token da Agent Platform").fill("platform-token");
  await page.getByRole("button", { name: "Salvar conexão" }).click();
  await expect(page.getByRole("status")).toContainText("Conexão salva com segurança");
  expect(submittedConnection).toMatchObject({
    kind: "agent-platform",
    credentials: { baseUrl: "https://platform.example", token: "platform-token" },
  });
  await expect(page.getByLabel("Token da Agent Platform")).toHaveValue("");
  await page.screenshot({ path: `test-results/agent-platform-${testInfo.project.name}.png`, fullPage: true });
});

test("creates an agent and imports a JSON case batch", async ({ page }, testInfo) => {
  let createdAgent: Record<string, unknown> | null = null;
  let importedCases: Record<string, unknown> | null = null;
  await page.route("**/api/v1/agents", async (route) => {
    createdAgent = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ...createdAgent, createdAt: new Date().toISOString() }) });
  });
  await page.route("**/api/v1/cases/import", async (route) => {
    importedCases = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ imported: 2 }) });
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("ID do agente").fill("support-agent");
  await page.getByLabel("ID do domínio").fill("support");
  await page.getByLabel("Nome do agente").fill("Support");
  await page.getByRole("button", { name: "Cadastrar agente" }).click();
  await expect(page.getByText("Agente cadastrado.")).toBeVisible();
  await page.getByLabel("Casos JSON").fill(JSON.stringify([
    { id: "case-a", sessionId: "s-a", similarityGroup: "g-a", content: "Question A" },
    { id: "case-b", sessionId: "s-b", similarityGroup: "g-b", content: "Question B" },
  ]));
  await page.getByRole("button", { name: "Importar casos" }).click();
  await expect(page.getByText("Casos importados com sucesso.")).toBeVisible();
  expect(createdAgent).toMatchObject({ id: "support-agent", domainId: "support", name: "Support" });
  expect(importedCases).toMatchObject({ agentId: "support-agent", domainId: "support", source: "json" });
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(hasHorizontalOverflow).toBe(false);
  await page.screenshot({ path: `test-results/case-intake-${testInfo.project.name}.png`, fullPage: true });
});

test("starts a round for an agent and selects the persisted round", async ({ page }, testInfo) => {
  let submittedRound: Record<string, unknown> | null = null;
  await page.route("**/api/v1/agents", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ id: "support-agent", domainId: "support", name: "Support" }] }) });
  });
  await page.route("**/api/v1/rounds", async (route) => {
    if (route.request().method() === "POST") {
      submittedRound = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ...submittedRound, state: "setup", createdAt: new Date().toISOString() }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });
  await page.route("**/api/v1/rounds/*/events", async (route) => {
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }, body: ": connected\n\n" });
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "Rodadas" }).click();
  await page.getByLabel("Agente").selectOption("support-agent");
  await page.getByLabel("Objetivo da rodada").fill("Improve support answers");
  await page.getByRole("button", { name: "Iniciar rodada" }).click();
  await expect(page.getByText("Improve support answers")).toBeVisible();
  expect(submittedRound).toMatchObject({ agentId: "support-agent", domainId: "support", objective: "Improve support answers" });
  await page.screenshot({ path: `test-results/rounds-${testInfo.project.name}.png`, fullPage: true });
});

test("shows persisted result decisions and limitations", async ({ page }, testInfo) => {
  await page.route("**/api/v1/rounds", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ id: "round-result", state: "rejected" }] }) });
  });
  await page.route("**/api/v1/rounds/round-result/results", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ roundId: "round-result", decision: "rejected", sampleSize: 2, confidence: 0.75, rationale: "Regression gate failed.", limitations: ["Human review incomplete"] }),
    });
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "Resultados" }).click();
  await expect(page.getByText("round-result")).toBeVisible();
  await expect(page.getByText("Rejeitado")).toBeVisible();
  await expect(page.getByText("Regression gate failed.")).toBeVisible();
  await page.screenshot({ path: `test-results/results-${testInfo.project.name}.png`, fullPage: true });
});

test("imports CSV with server-owned provenance", async ({ page }, testInfo) => {
  let importedCsv: Record<string, unknown> | null = null;
  await page.route("**/api/v1/agents", async (route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "csv-agent" }) }));
  await page.route("**/api/v1/cases/import-csv", async (route) => {
    importedCsv = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ imported: 1 }) });
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("ID do agente").fill("csv-agent");
  await page.getByLabel("ID do domínio").fill("csv-domain");
  await page.getByLabel("Nome do agente").fill("CSV");
  await page.getByRole("button", { name: "Cadastrar agente" }).click();
  await expect(page.getByText("Agente cadastrado.")).toBeVisible();
  await page.getByLabel("Formato do arquivo").selectOption("csv");
  await page.getByLabel("Casos CSV").fill("id,sessionId,similarityGroup,content\ncase-1,s-1,g-1,Example");
  await page.getByRole("button", { name: "Importar casos" }).click();
  await expect(page.getByText("Casos importados com sucesso.")).toBeVisible();
  expect(importedCsv).toMatchObject({ agentId: "csv-agent", domainId: "csv-domain", csv: expect.stringContaining("case-1") });
  await page.screenshot({ path: `test-results/csv-intake-${testInfo.project.name}.png`, fullPage: true });
});

test("requests cancellation for an active round and shows it as pending", async ({ page }, testInfo) => {
  await page.route("**/api/v1/agents", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }));
  await page.route("**/api/v1/rounds", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ items: [{ id: "round-active", agentId: "a", domainId: "d", objective: "Improve", state: "executing", createdAt: new Date().toISOString() }] }),
  }));
  await page.route("**/api/v1/rounds/round-active/cancel", async (route) => route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ cancellationRequested: true }) }));
  await page.route("**/api/v1/rounds/round-active/events", async (route) => route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: ": connected\n\n" }));
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "Rodadas" }).click();
  await page.getByRole("button", { name: /round-active/u }).click();
  await page.getByRole("button", { name: "Cancelar rodada" }).click();
  await expect(page.getByText(/Cancelamento solicitado/u)).toBeVisible();
  await page.screenshot({ path: `test-results/cancellation-${testInfo.project.name}.png`, fullPage: true });
});
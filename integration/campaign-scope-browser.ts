import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

/** Optional browser proof, entirely synthetic and isolated from personal browser profiles. */
export async function runCampaignScopeBrowser(base: string, token: string) {
  if (!process.env.TEST_BROWSER_MODULE) return;
  if (!process.env.TEST_DATABASE_URL || !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")) throw new Error("Isolated browser test configuration required");
  const { chromium } = await import(pathToFileURL(process.env.TEST_BROWSER_MODULE).href);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER_EXECUTABLE });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.addCookies([{ name: "market_research_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.goto(`${base}/campaigns`);
    await page.getByRole("heading", { name: "Market/language approval coverage" }).waitFor();
    assert.equal(await page.getByLabel("Revise declared scope").inputValue(), "DK/da, SE/sv");
    await page.getByLabel("Review scope").selectOption("SE/sv");
    assert.equal(await page.getByLabel("Review scope").inputValue(), "SE/sv");
    await page.screenshot({ path: "/private/tmp/market-research-campaign-scope-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "/private/tmp/market-research-campaign-scope-mobile.png" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.getByRole("button", { name: "Create campaign", exact: true }).click();
    await page.getByLabel("Target markets/languages").fill("DK/da, SE/sv");
    assert.equal(await page.getByLabel("Target markets/languages").inputValue(), "DK/da, SE/sv");
    for (const [label, value] of Object.entries({ name: "Synthetic browser scope draft", objective: "Consideration", audience: "Declared adults", proposition: "Accessible quality" })) await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole("button", { name: "Create proposed campaign" }).click();
    const draft = page.locator("article").filter({ has: page.getByRole("heading", { name: "Synthetic browser scope draft", exact: true }) });
    await draft.getByRole("button", { name: "Save declared scope" }).waitFor();
    const stale = await context.newPage(); await stale.goto(`${base}/campaigns`);
    const oldDraft = stale.locator("article").filter({ has: stale.getByRole("heading", { name: "Synthetic browser scope draft", exact: true }) });
    for (const [article, surface] of [[draft, page], [oldDraft, stale]]) {
      const form = article.locator("form").filter({ has: surface.getByRole("button", { name: "Save measurement plan", exact: true }) });
      await form.getByLabel("objective", { exact: true }).fill("Consideration by market");
      await form.getByLabel("hypothesis", { exact: true }).fill("Consideration may change independently in each market.");
      for (const [index, pair] of ["DK/da", "SE/sv"].entries()) {
        const scope = form.getByRole("group", { name: `${pair} measurement`, exact: true });
        const population = index ? "Swedish adults" : "Danish adults";
        await scope.locator(`input[name="${index}-population"]`).fill(population);
        for (const [field, value] of Object.entries({ checkpoints: "2026-11-01", attributionAssumptions: "Descriptive only", decisionRules: "Review this market separately" })) await scope.locator(`input[name="${index}-${field}"]`).fill(value);
        for (const [field, value] of Object.entries({ key: "consideration", label: "Consideration", population, unit: "rate", baseline: index ? "0.5" : "0.2", target: index ? "0.65" : "0.25", materiality: "0.02" })) await scope.locator(`input[name="${index}-metric-0-${field}"]`).fill(value);
        if (index) {
          await scope.getByRole("button", { name: "Add metric", exact: true }).click();
          for (const [field, value] of Object.entries({ key: "awareness", label: "Awareness", population, unit: "rate", baseline: "0.4", target: "0.5", materiality: "0.03" })) await scope.locator(`input[name="${index}-metric-1-${field}"]`).fill(value);
        }
      }
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
    await draft.getByRole("group", { name: "SE/sv measurement", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/private/tmp/market-research-measurement-scope-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await draft.getByRole("group", { name: "SE/sv measurement", exact: true }).locator("legend").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/private/tmp/market-research-measurement-scope-mobile.png" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await draft.getByRole("button", { name: "Save measurement plan", exact: true }).click();
    await draft.getByText("Measurement coverage: DK/da (1 metrics), SE/sv (2 metrics)", { exact: true }).waitFor();
    await oldDraft.getByRole("button", { name: "Save measurement plan", exact: true }).click();
    await stale.getByText("The campaign or measurement plan changed in another session.", { exact: false }).waitFor();
    await draft.getByLabel("Revise declared scope").fill("DK/da");
    await draft.getByRole("button", { name: "Save declared scope" }).click();
    await draft.getByText("Revision 2", { exact: true }).waitFor();
    await oldDraft.getByLabel("Revise declared scope").fill("SE/sv");
    await oldDraft.getByRole("button", { name: "Save declared scope" }).click();
    await stale.getByText("The campaign changed in another session.", { exact: false }).waitFor();
    await page.reload();
    assert.equal(await draft.getByLabel("Revise declared scope").inputValue(), "DK/da");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

export async function runScopedResultBrowser(base: string, token: string) {
  if (!process.env.TEST_BROWSER_MODULE) return;
  if (!process.env.TEST_DATABASE_URL || !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")) throw new Error("Isolated browser test configuration required");
  const { chromium } = await import(pathToFileURL(process.env.TEST_BROWSER_MODULE).href);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER_EXECUTABLE });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.addCookies([{ name: "market_research_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage(), errors: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.goto(`${base}/campaigns`);
    const draft = page.locator("article").filter({ has: page.getByRole("heading", { name: "Synthetic two-market campaign", exact: true }) });
    assert.equal(await draft.count(), 1, await page.locator("body").innerText());
    assert.match(await draft.innerText(), /Live source-backed readback/);
    await page.screenshot({ path: "/private/tmp/market-research-scoped-result-initial.png" });
    const form = draft.locator("form").filter({ has: page.getByRole("heading", { name: "Live source-backed readback", exact: true }) });
    assert.equal(await form.count(), 1);
    await form.locator('select[name="resultScope"]').selectOption("DK/da");
    await form.getByText("Population: Danish adults.", { exact: false }).waitFor();
    const baseline = form.locator('select[name="metric-0-baseline"]');
    await baseline.selectOption({ index: 1 });
    assert.notEqual(await baseline.inputValue(), "");
    await form.locator('select[name="resultScope"]').selectOption("SE/sv");
    await form.getByText("Population: Swedish adults.", { exact: false }).waitFor();
    assert.equal(await baseline.inputValue(), "", "changing scope clears all prior selections");
    assert.equal(await form.locator('input[name="market"]').inputValue(), "SE");
    await form.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/private/tmp/market-research-scoped-result-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await form.getByRole("heading", { name: "Live source-backed readback", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/private/tmp/market-research-scoped-result-mobile.png" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

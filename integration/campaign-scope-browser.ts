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

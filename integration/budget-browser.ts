import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

/** Optional local browser proof using an installed Playwright module, never a live client/session. */
export async function runBudgetBrowserCase(base: string, token: string) {
  if (!process.env.TEST_BROWSER_MODULE || !process.env.TEST_DATABASE_URL || !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")) throw new Error("Isolated browser test configuration required");
  const { chromium } = await import(pathToFileURL(process.env.TEST_BROWSER_MODULE).href);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER_EXECUTABLE || undefined });
  const errors: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: "market_research_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage(); const stale = await context.newPage();
    for (const tab of [page, stale]) tab.on("pageerror", (error: Error) => errors.push(error.message));
    await page.goto(`${base}/configuration`); await stale.goto(`${base}/configuration`);
    const acquisition = page.getByRole("article", { name: "Source acquisition" });
    await acquisition.getByRole("button", { name: "Edit acquisition budget" }).click();
    await acquisition.getByLabel("Currency code").fill("DKK");
    await acquisition.getByLabel("Daily amount in currency units").fill("0.125001");
    await acquisition.getByLabel("Daily request cap").fill("7");
    await acquisition.getByLabel("Daily record cap").fill("12");
    await acquisition.getByLabel("I approve these limits", { exact: false }).check();
    await acquisition.getByLabel("Daily request cap").fill("8");
    assert.equal(await acquisition.getByLabel("I approve these limits", { exact: false }).isChecked(), false);
    assert.equal(await acquisition.getByRole("button", { name: "Save budget limits" }).isEnabled(), false);
    await acquisition.getByLabel("I approve these limits", { exact: false }).check();
    await acquisition.getByRole("button", { name: "Save budget limits" }).click();
    await page.getByRole("status").filter({ hasText: "Budget limits saved" }).waitFor();
    await acquisition.getByText("0.125001 DKK", { exact: true }).waitFor();
    await acquisition.getByText("Allowance disabled", { exact: true }).waitFor();

    const synthesis = page.getByRole("article", { name: "Research synthesis" });
    await synthesis.getByRole("button", { name: "Edit synthesis budget" }).click();
    await synthesis.getByLabel("Daily request cap").fill("9");
    await synthesis.getByLabel("I approve these limits", { exact: false }).check();
    await synthesis.getByRole("button", { name: "Save budget limits" }).click();
    await page.getByRole("status").filter({ hasText: "Budget limits saved" }).waitFor();
    await synthesis.getByText("0 / 9", { exact: true }).waitFor();
    const old = stale.getByRole("article", { name: "Research synthesis" });
    await old.getByRole("button", { name: "Edit synthesis budget" }).click();
    await old.getByLabel("Daily request cap").fill("12");
    await old.getByLabel("I approve these limits", { exact: false }).check();
    await old.getByRole("button", { name: "Save budget limits" }).click();
    await old.getByRole("alert").filter({ hasText: "This budget changed" }).waitFor();
    assert.equal(await old.getByRole("button", { name: "Save budget limits" }).isEnabled(), false);
    await stale.getByRole("button", { name: "Refresh (discard edits)" }).click();
    await old.getByText("0 / 9", { exact: true }).waitFor();
    await page.screenshot({ path: "/private/tmp/market-research-budget-desktop.png", fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.getByRole("heading", { name: "Budgets & recovery" }).waitFor();
    // Large but disabled synthetic limits prove exact entry and narrow-screen wrapping.
    await acquisition.getByRole("button", { name: "Edit acquisition budget" }).click();
    await acquisition.getByLabel("Daily amount in currency units").fill("9007199254.740991");
    await acquisition.getByLabel("Daily request cap").fill("9007199254740991");
    await acquisition.getByLabel("Daily record cap").fill("9007199254740991");
    await acquisition.getByLabel("I approve these limits", { exact: false }).check();
    await acquisition.getByRole("button", { name: "Save budget limits" }).click();
    await acquisition.getByText("9007199254.740991 DKK", { exact: true }).waitFor();
    await acquisition.getByText("Allowance disabled", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: "/private/tmp/market-research-budget-mobile.png", fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

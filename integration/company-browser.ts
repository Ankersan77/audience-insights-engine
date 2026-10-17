import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";

export async function runCompanyBrowserCase(base: string, token: string) {
  if (!process.env.TEST_BROWSER_MODULE || !process.env.TEST_DATABASE_URL || !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")) throw new Error("Isolated browser configuration required");
  const { chromium } = await import(pathToFileURL(process.env.TEST_BROWSER_MODULE).href);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_BROWSER_EXECUTABLE || undefined });
  const errors: string[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: "market_research_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage(); const stale = await context.newPage();
    for (const tab of [page, stale]) { tab.on("pageerror", (error: Error) => errors.push(error.message)); await tab.goto(`${base}/company`); }
    await page.getByLabel("Import profile content JSON").setInputFiles(fileURLToPath(new URL("../fixtures/d4wn/company-context.json", import.meta.url)));
    await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('[name="name"]')?.value === "D4WN");
    assert.equal(await page.getByLabel("Company name", { exact: true }).inputValue(), "D4WN");
    await page.getByLabel("Review due", { exact: true }).fill(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
    await page.getByLabel("Reason for this version").fill("Synthetic test of owner-confirmed import");
    await page.getByRole("button", { name: "Save company profile version" }).click();
    await page.getByRole("heading", { name: "Current company profile · version 2", exact: true }).waitFor();
    await page.reload(); assert.equal(await page.getByLabel("Company name", { exact: true }).inputValue(), "D4WN");
    await stale.getByLabel("Reason for this version").fill("Stale edit");
    await stale.getByRole("button", { name: "Save company profile version" }).click();
    await stale.getByRole("alert").filter({ hasText: "changed in another session" }).waitFor();
    await page.screenshot({ path: "/private/tmp/market-research-company-desktop.png", fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 }); await page.reload();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: "/private/tmp/market-research-company-mobile.png", fullPage: false });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

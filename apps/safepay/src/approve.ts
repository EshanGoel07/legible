/**
 * TEST ONLY: approves a PayPal Sandbox order as the sandbox buyer with Playwright.
 * Resolves once PayPal redirects to our return_url (i.e. the order is approved).
 * Credentials come from env and are never logged. Only used when SAFEPAY_TEST_MODE=1.
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";
import type { Approver } from "./service.js";

export type ApproverOptions = {
  email: string;
  password: string;
  /** URL prefix PayPal redirects to after approval, e.g. http://localhost:3003/safepay/return */
  returnUrlPrefix: string;
  headless?: boolean;
  timeoutMs?: number;
  /** Where to save a screenshot if approval fails (never contains the password field value) */
  failureDir?: string;
};

const SEL = {
  cookieAccept: "#acceptAllButton",
  email: "#email",
  next: "#btnNext",
  password: "#password",
  login: "#btnLogin",
  pay: [
    '[data-testid="submit-button-initial"]',
    "#payment-submit-btn",
    'button:has-text("Complete Purchase")',
    'button:has-text("Pay Now")',
    'button:has-text("Continue to Review Order")',
    'button:has-text("Continue")',
  ],
};

async function visible(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().isVisible().catch(() => false);
}

export function createPlaywrightApprover(opts: ApproverOptions): Approver {
  if (!opts.email || !opts.password) throw new Error("PAYPAL_SANDBOX_BUYER_EMAIL and PAYPAL_SANDBOX_BUYER_PASSWORD are required for test approval");
  const timeoutMs = opts.timeoutMs ?? 120_000;

  return async (approvalUrl: string) => {
    if (!new URL(approvalUrl).host.endsWith("sandbox.paypal.com")) throw new Error("refusing to approve a non-sandbox PayPal URL");
    const browser = await chromium.launch({ headless: opts.headless ?? true });
    const page = await (await browser.newContext()).newPage();
    const deadline = Date.now() + timeoutMs;
    let emailDone = false;
    let passwordDone = false;
    try {
      await page.goto(approvalUrl, { waitUntil: "domcontentloaded" });
      while (!page.url().startsWith(opts.returnUrlPrefix)) {
        if (Date.now() > deadline) throw new Error(`sandbox approval timed out at ${new URL(page.url()).pathname}`);

        if (await visible(page, SEL.cookieAccept)) await page.locator(SEL.cookieAccept).click().catch(() => {});

        if (!emailDone && (await visible(page, SEL.email)) && (await page.locator(SEL.email).isEditable().catch(() => false))) {
          await page.locator(SEL.email).fill(opts.email);
          emailDone = true;
          if (await visible(page, SEL.next)) await page.locator(SEL.next).click();
          continue;
        }
        if (!passwordDone && (await visible(page, SEL.password))) {
          await page.locator(SEL.password).fill(opts.password);
          passwordDone = true;
          await page.locator(SEL.login).click();
          await page.waitForLoadState("domcontentloaded").catch(() => {});
          continue;
        }
        let clicked = false;
        for (const s of SEL.pay) {
          if (await visible(page, s)) {
            const btn = page.locator(s).first();
            if (await btn.isEnabled().catch(() => false)) {
              await btn.click().catch(() => {});
              clicked = true;
              break;
            }
          }
        }
        await page.waitForTimeout(clicked ? 2500 : 1000);
      }
    } catch (e) {
      if (opts.failureDir) {
        mkdirSync(opts.failureDir, { recursive: true });
        await page.screenshot({ path: `${opts.failureDir}/approve-failure.png`, fullPage: true }).catch(() => {});
      }
      throw e;
    } finally {
      await browser.close();
    }
  };
}

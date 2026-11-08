import { describe, expect, it } from "vitest";
import { BrowserLimitError, isBrowserLimitError } from "../src/errors";

describe("Browser Rendering limit errors", () => {
  it("recognises puppeteer.launch limit failures", () => {
    for (const m of [
      "Unable to create new browser: code: 429: message: Too many browsers already running",
      "Unable to create new browser: code: 429: message: Rate limit exceeded",
      "Browser time limit exceeded for today",
    ]) {
      expect(isBrowserLimitError(new Error(m)), m).toBe(true);
    }
  });

  it("does not mistake other failures for limits", () => {
    for (const m of ["Unable to create new browser: code: 500: message: internal error", "net::ERR_NAME_NOT_RESOLVED", "Protocol error: Target closed"]) {
      expect(isBrowserLimitError(new Error(m)), m).toBe(false);
    }
  });

  it("explains the free-plan limits in the message", () => {
    const msg = new BrowserLimitError("code: 429").message;
    expect(msg).toMatch(/3 concurrent browsers/);
    expect(msg).toMatch(/1 new browser every 20 seconds/);
    expect(msg).toMatch(/10 browser-minutes per day/);
  });
});

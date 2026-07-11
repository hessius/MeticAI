import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isCoreInterceptorEnabled } from "./coreInterceptorFlag";

const STORAGE_KEY = "metic:experimental:core-interceptor";

describe("isCoreInterceptorEnabled", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("is off by default", () => {
    expect(isCoreInterceptorEnabled()).toBe(false);
  });

  it("is on when the localStorage flag is 'true'", () => {
    localStorage.setItem(STORAGE_KEY, "true");
    expect(isCoreInterceptorEnabled()).toBe(true);
  });

  it("ignores non-'true' localStorage values", () => {
    localStorage.setItem(STORAGE_KEY, "1");
    expect(isCoreInterceptorEnabled()).toBe(false);
  });

  it("is on via ?coreInterceptor=1 query", () => {
    window.history.replaceState({}, "", "/?coreInterceptor=1");
    expect(isCoreInterceptorEnabled()).toBe(true);
  });

  it("query ?coreInterceptor=0 overrides an enabled localStorage flag", () => {
    localStorage.setItem(STORAGE_KEY, "true");
    window.history.replaceState({}, "", "/?coreInterceptor=0");
    expect(isCoreInterceptorEnabled()).toBe(false);
  });
});

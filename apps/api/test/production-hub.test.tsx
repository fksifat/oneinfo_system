import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../../control-center/src/App.js";

afterEach(() => vi.unstubAllGlobals());

it.each([
  ["https://oneinfo-system.vercel.app/admin#production", false],
  ["http://127.0.0.1:5174/#production", true],
])("opens a local console outside a hosted page (%s)", (url, embedded) => {
  vi.stubGlobal("window", { location: new URL(url) });
  vi.stubGlobal("localStorage", { getItem: () => "test-operator-token" });
  const html = renderToStaticMarkup(<App />);
  expect(html.includes('class="production-frame"')).toBe(embedded);
  expect(html).toContain('href="http://127.0.0.1:5173" target="_blank" rel="noreferrer"');
  expect(html).toContain("Open production console");
  expect((html.match(/href="http:\/\/127\.0\.0\.1:5173"/g) ?? []).length).toBe(1);
  expect(html.includes("Connect your production PC")).toBe(!embedded);
  expect(html).not.toContain("workstation-steps-grid");
  expect(html).not.toContain("test-operator-token");
});

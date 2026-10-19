// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { rules } from "@castellan/shared";
import { Battles } from "../src/routes/Battles";
import type { ReplaySummary } from "../src/api";

let replays: ReplaySummary[];
vi.mock("@tanstack/react-router", () => ({ Link: ({ children, to, params, ...props }: any) =>
  createElement("a", { ...props, href: params?.id ? to.replace("$id", params.id) : to }, children) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: ({ queryKey }: { queryKey: string[] }) =>
  ({ data: queryKey[0] === "replays" ? replays : [], isPending: false, isError: false, isSuccess: true }) }));
vi.mock("../src/audio/sfx", () => ({ sfx: { holdMusic: () => () => {} } }));
vi.mock("../src/components/Hud", () => ({ SoundToggle: () => null }));

let root: Root, host: HTMLDivElement;
const battle = (id: string, teams: number[], efforts: (string | null)[]): ReplaySummary => ({
  id, createdAt: "2026-10-14T00:00:00Z", rulesVersion: rules.version, map: "fortress-quad", source: "local",
  finalTick: 1200, tickRate: 10, outcome: { winner: "p1", reason: "vital_lost", scores: {} },
  players: teams.map((team, i) => ({ id: `p${i + 1}`, name: `Model ${i + 1}`, team, effort: efforts[i] })),
});
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  replays = [battle("duel", [0, 1], ["low", "high"]), battle("teams", [0, 0, 1, 1], ["low", "max", "off", null]), battle("ffa", [0, 1, 2], ["low", "medium", "xhigh"])];
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(Battles)));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("filters actual replay links by format and restores the full catalog", async () => {
  const links = () => [...host.querySelectorAll<HTMLAnchorElement>(".battle-open")].map(a => a.getAttribute("href"));
  const filter = (label: string) => [...host.querySelectorAll<HTMLButtonElement>(".battles-filters button")].find(b => b.textContent?.startsWith(label))!;
  expect(links()).toEqual(["/replay/duel", "/replay/teams", "/replay/ffa"]);
  await act(async () => filter("2v2").click());
  expect(links()).toEqual(["/replay/teams"]);
  expect(filter("2v2").getAttribute("aria-pressed")).toBe("true");
  await act(async () => filter("Free-for-all").click());
  expect(links()).toEqual(["/replay/ffa"]);
  await act(async () => filter("All battles").click());
  expect(links()).toHaveLength(3);
});

it("keeps allies together and displays recorded effort, including off and unknown", () => {
  const card = host.querySelector('a[href="/replay/teams"]')!.closest("article")!;
  const sides = [...card.querySelectorAll(".versus > span")];
  expect(sides.map(s => [...s.querySelectorAll(".agent b")].map(p => p.textContent))).toEqual([["Model 1", "Model 2"], ["Model 3", "Model 4"]]);
  expect([...card.querySelectorAll(".agent-effort")].map(e => e.textContent?.replace(/^ · /, ""))).toEqual(["Low effort", "Max effort", "Reasoning off", "Effort not recorded"]);
});

it("links to the replay with compact match metadata and no result or source label", () => {
  const card = host.querySelector('a[href="/replay/duel"]')!.closest("article")!;
  expect(card.querySelector(".battle-heading")?.textContent).toBe(`Fortress · 1v12:00 · v${rules.version.split(".").slice(0, 2).join(".")}`);
  expect(card.querySelector(".battle-watch")?.textContent).toBe("Watch replay");
  expect(card.textContent).not.toMatch(/Show result|Local|won/);
  expect(card.querySelector("button")).toBeNull();
});

it("filters by rules version, counting formats within the chosen version", async () => {
  replays = [battle("now", [0, 1], ["low", "low"]), { ...battle("then", [0, 1, 2], ["low", "low", "low"]), rulesVersion: "v26-coordinated-movement" }];
  await act(async () => root.render(createElement(Battles)));
  const links = () => [...host.querySelectorAll<HTMLAnchorElement>(".battle-open")].map(a => a.getAttribute("href"));
  const select = host.querySelector<HTMLSelectElement>(".battles-version select")!;
  expect([...select.options].map(o => o.textContent)).toEqual(["All versions", `v${rules.version.split(".").slice(0, 2).join(".")}`, "v26"]);
  expect(links()).toEqual(["/replay/now", "/replay/then"]);
  await act(async () => { select.value = "v26"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(links()).toEqual(["/replay/then"]);
  expect(host.querySelector(".battles-filters button")?.textContent).toBe("All battles 1");
});

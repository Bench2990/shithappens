import { describe, expect, it } from "vitest";
import { formatScore, placementLabel } from "../lib/game/format";
import { errorMessage } from "../lib/game/api";
import events from "../data/events.hu.json" with { type: "json" };

describe("Magyar megjelenítés", () => {
  it("pontosan és magyar tizedesvesszővel formáz", () => {
    expect(formatScore(674)).toBe("67,4");
    expect(formatScore(480)).toBe("48");
    expect(formatScore(480, true)).toBe("48,0");
    expect(formatScore(10)).toBe("1");
    expect(formatScore(1000, true)).toBe("100,0");
  });
  it("a két sorvéget és a köztes pozíciót is leírja", () => {
    expect(placementLabel(null, 120)).toBe("12 elé");
    expect(placementLabel(830, null)).toBe("83 mögé");
    expect(placementLabel(480, 830)).toBe("48 és 83 közé");
  });
  it("érthető magyar hibát ad belépési és hálózati problémára", () => {
    expect(errorMessage(new Error("Anonymous sign-ins are disabled"))).toContain("névtelen belépés");
    expect(errorMessage(new Error("Failed to fetch"))).toContain("kapcsolatot");
  });
});

describe("Eredeti magyar eseménygyűjtemény", () => {
  it("hat játékos biztos győzelméhez elegendő különböző, előre nem pontozott eseményt ad", () => {
    expect(events.length).toBeGreaterThanOrEqual(6 * 9 + 1);
    expect(new Set(events.map((event) => event.title)).size).toBe(events.length);
    for (const event of events) {
      expect(event.title.length).toBeGreaterThanOrEqual(3);
      expect(event.description.length).toBeGreaterThanOrEqual(5);
      expect(Object.keys(event).sort()).toEqual(["active", "description", "title"]);
    }
  });
});

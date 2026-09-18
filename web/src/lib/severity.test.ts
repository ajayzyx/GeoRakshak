import { describe, expect, it } from "vitest";
import { SEVERITY_COLORS, UNKNOWN_SEVERITY_COLOR, severityColor, severityColorExpression, severityLabel, severityLegend } from "./severity";
import { deliveryStatusLabel } from "./labels";

describe("severity mapping", () => {
  it("maps each contract severity to a distinct colour", () => {
    expect(severityColor("LOW")).toBe(SEVERITY_COLORS.LOW);
    expect(severityColor("VERY_HIGH")).toBe(SEVERITY_COLORS.VERY_HIGH);
    expect(new Set(Object.values(SEVERITY_COLORS)).size).toBe(4);
  });
  it("never guesses a class for unknown or missing severity", () => {
    expect(severityColor("EXTREME")).toBe(UNKNOWN_SEVERITY_COLOR);
    expect(severityColor(null)).toBe(UNKNOWN_SEVERITY_COLOR);
    expect(severityLabel(undefined)).toBe("Unknown");
  });
  it("legend lists LOW → VERY_HIGH in order with matching colours", () => {
    expect(severityLegend()).toEqual([
      { key: "LOW", label: "Low", color: SEVERITY_COLORS.LOW },
      { key: "MODERATE", label: "Moderate", color: SEVERITY_COLORS.MODERATE },
      { key: "HIGH", label: "High", color: SEVERITY_COLORS.HIGH },
      { key: "VERY_HIGH", label: "Very High", color: SEVERITY_COLORS.VERY_HIGH },
    ]);
  });
  it("map expression uses the same colours with an unknown fallback", () => {
    const expr = severityColorExpression();
    expect(expr.slice(0, 2)).toEqual(["match", ["get", "severity"]]);
    expect(expr).toContain(SEVERITY_COLORS.HIGH);
    expect(expr[expr.length - 1]).toBe(UNKNOWN_SEVERITY_COLOR);
  });
});

describe("delivery status labels", () => {
  it("shows SANDBOXED as not sent and never shows a sandbox delivery as sent", () => {
    expect(deliveryStatusLabel("SANDBOXED", "SANDBOX").text).toBe("Sandbox — not sent");
    expect(deliveryStatusLabel("SENT", "SANDBOX").text).not.toBe("Sent");
    expect(deliveryStatusLabel("SENT", "LIVE").text).toBe("Sent");
  });
});

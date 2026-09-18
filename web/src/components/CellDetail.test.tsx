import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CellDetail } from "./CellDetailPanel";
import type { RiskZoneDetail } from "../api/types";

// Shape and values copied from the fictional api.md §5.3 example (test fixture only, not real data).
const detail: RiskZoneDetail = {
  id: "a3b9",
  grid_code: "PILOT-0412-0877",
  admin_boundary: { id: "d01", name: "Pilot District (demo)" },
  assessment: {
    id: "ra77", lead_time_h: 0, score: 0.78, severity: "VERY_HIGH", confidence: "MEDIUM",
    model_version: "susc-gbm-0.1.0+trigger-rules-0.1.0", issue_time: "2026-07-14T06:00:00Z", run_mode: "DEMO_REPLAY", provenance: "MODEL_OUTPUT",
    factors: [
      { feature: "rain_3d_mm", label: "3-day rainfall", value: 182.0, unit: "mm", contribution: 0.24, direction: "increases_risk", component: "TRIGGER", text: "3-day rainfall is far above this area's usual level for this time of year", provenance: "REAL_HISTORICAL" },
      { feature: "ndvi_mean", label: "Vegetation (satellite)", value: 0.31, unit: null, contribution: 0.08, direction: "decreases_risk", component: "SUSCEPTIBILITY", text: "Vegetation text", provenance: "REAL_HISTORICAL" },
      { feature: "sensor_vwc", label: "Soil moisture sensor", value: 0.44, unit: "m3/m3", contribution: 0.06, direction: "increases_risk", component: "SENSOR_ADJUSTMENT", text: "Nearby soil moisture reading is high (virtual sensor, simulated)", provenance: "SIMULATED_DEMO", station_code: "VS-02" },
    ],
  },
  exposure: { villages: 3, schools: 1, health_facilities: 1, road_segments_at_risk: 2 },
  open_alerts: [{ id: "al55", tier: "WATCH", status: "AUTO_DISPATCHED" }],
  disclaimer: "Decision-support risk estimate. Not an official warning.",
};

describe("CellDetail", () => {
  it("renders severity, score, model version and issue time", () => {
    render(<CellDetail detail={detail} />);
    expect(screen.getByText("Very High")).toBeTruthy();
    expect(screen.getByText("0.78")).toBeTruthy();
    expect(screen.getByText("susc-gbm-0.1.0+trigger-rules-0.1.0")).toBeTruthy();
    expect(screen.getByText("2026-07-14 06:00 UTC")).toBeTruthy();
  });

  it("renders every factor with value+unit, direction, text and a provenance badge", () => {
    render(<CellDetail detail={detail} />);
    const factors = screen.getAllByTestId("factor");
    expect(factors).toHaveLength(3);
    const rain = within(factors[0]);
    expect(rain.getByText("3-day rainfall")).toBeTruthy();
    expect(rain.getByText("182 mm")).toBeTruthy();
    expect(rain.getByText(/increases risk/)).toBeTruthy();
    expect(rain.getByTestId("provenance-badge").textContent).toContain("REAL_HISTORICAL");
    expect(within(factors[1]).getByText(/decreases risk/)).toBeTruthy();
    const sensor = within(factors[2]);
    expect(sensor.getByTestId("provenance-badge").textContent).toContain("SIMULATED_DEMO");
    expect(sensor.getByText("Virtual sensor (simulated)")).toBeTruthy();
    expect(sensor.getByText("VS-02")).toBeTruthy();
  });

  it("shows the assessment provenance, exposure, open alerts and the disclaimer", () => {
    render(<CellDetail detail={detail} />);
    const badges = screen.getAllByTestId("provenance-badge").map((b) => b.textContent);
    expect(badges.some((t) => t?.includes("MODEL_OUTPUT"))).toBe(true);
    expect(screen.getByText("Villages:").textContent).toContain("Villages");
    expect(screen.getByText("WATCH")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toBe("Decision-support risk estimate. Not an official warning.");
  });

  it("shows a zero-contribution factor as no effect, not as increasing risk", () => {
    const noRain = structuredClone(detail);
    noRain.assessment!.factors[0] = { ...detail.assessment!.factors[0], value: null, contribution: 0, text: "No rainfall input for this cell." };
    render(<CellDetail detail={noRain} />);
    const rain = within(screen.getAllByTestId("factor")[0]);
    expect(rain.getByText("no effect")).toBeTruthy();
    expect(rain.queryByText(/increases risk/)).toBeNull();
  });

  it("labels a factor without provenance instead of hiding it", () => {
    const broken = structuredClone(detail);
    (broken.assessment!.factors[0] as { provenance: unknown }).provenance = undefined;
    render(<CellDetail detail={broken} />);
    expect(screen.getByText("Provenance not reported")).toBeTruthy();
  });
});

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MediaView, ReporterRoleBadge, resolveMediaUrl } from "./Reports";
import { DeliveryTable } from "./Alerts";

describe("report media and reporter role", () => {
  it("renders <video controls> for VIDEO and <img> for PHOTO", () => {
    render(<MediaView media={{ media_type: "VIDEO" }} url="https://media.example.org/v.mp4" />);
    const video = screen.getByTestId("media-video") as HTMLVideoElement;
    expect(video.tagName).toBe("VIDEO");
    expect(video.controls).toBe(true);
    render(<MediaView media={{ media_type: "PHOTO" }} url="https://media.example.org/p.jpg" />);
    expect(screen.getByTestId("media-photo").tagName).toBe("IMG");
  });

  it("resolves relative media URLs against the API origin", () => {
    expect(resolveMediaUrl("/media/files/x.jpg", "http://localhost:8000/api/v1")).toBe("http://localhost:8000/media/files/x.jpg");
    expect(resolveMediaUrl("https://cdn.example.org/x.jpg", "http://localhost:8000/api/v1")).toBe("https://cdn.example.org/x.jpg");
  });

  it("marks citizen reports as requiring moderation", () => {
    render(<ReporterRoleBadge role="CITIZEN" />);
    expect(screen.getByText("Citizen · moderation required")).toBeTruthy();
  });
});

describe("DeliveryTable", () => {
  it("shows SANDBOXED SMS as 'Sandbox — not sent' with rendered text", () => {
    render(
      <DeliveryTable
        items={[
          { recipient: "Demo Citizen", channel: "SMS", channel_mode: "SANDBOX", language: "hi", destination_masked: "+91******0000", status: "SANDBOXED", rendered_text: "Rendered Hindi template", queued_at: "2026-07-14T06:20:10Z" },
        ]}
      />,
    );
    expect(screen.getByText("Sandbox — not sent")).toBeTruthy();
    expect(screen.queryByText("Sent")).toBeNull();
    expect(screen.getByText(/Rendered Hindi template/)).toBeTruthy();
  });
});

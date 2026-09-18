#!/usr/bin/env node
// Browser smoke test for the GeoRakshak dashboard: drives a locally installed Chrome over the
// DevTools Protocol with Node's built-in fetch and WebSocket. No extra dependencies.
//
// Read-only: it logs in and looks at the dashboard. It never resets, steps or mutates anything.
//
//   npm run smoke:browser
//   WEB_URL=http://localhost:5174 API_URL=http://localhost:8001/api/v1 npm run smoke:browser
//
// Env: WEB_URL, API_URL, EMAIL, PASSWORD, CHROME_PATH, OUT_DIR (screenshots),
//      EXPECTED_HTTP (comma-separated "status path" allow-list), TIMEOUT_MS, HEADLESS=0.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WEB_URL = process.env.WEB_URL || "http://localhost:5173";
const API_URL = process.env.API_URL || "http://localhost:8000/api/v1";
const EMAIL = process.env.EMAIL || "authority.demo@example.org";
const PASSWORD = process.env.PASSWORD || "georakshak-local-demo";
const OUT_DIR = process.env.OUT_DIR || null;
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 40000);
const PORT = Number(process.env.CDP_PORT || 9444);
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
// GET /models/active answers 404 while no model is registered; that is a normal state, not a failure.
const EXPECTED_HTTP = (process.env.EXPECTED_HTTP || "404 /models/active").split(",").map((s) => s.trim()).filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const notes = [];
const log = (msg) => console.log(msg);
const ok = (msg) => log(`  ok   ${msg}`);
const fail = (msg) => {
  failures.push(msg);
  log(`  FAIL ${msg}`);
};

function findChrome() {
  const path = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!path) {
    console.error(`No Chrome found. Set CHROME_PATH. Tried:\n${CHROME_CANDIDATES.map((p) => `  ${p}`).join("\n")}`);
    process.exit(2);
  }
  return path;
}

async function portInUse() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function connect() {
  const chromePath = findChrome();
  if (await portInUse()) {
    console.error(`A browser is already listening on the DevTools port ${PORT}. Close it or set CDP_PORT to another port.`);
    process.exit(2);
  }
  const profile = mkdtempSync(join(tmpdir(), "georakshak-smoke-"));
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1600,1000",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "about:blank",
  ];
  if (process.env.HEADLESS !== "0") args.unshift("--headless=new");
  const chrome = spawn(chromePath, args, { stdio: "ignore" });

  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      target = list.find((t) => t.type === "page");
    } catch {
      /* not up yet */
    }
    if (!target) await sleep(250);
  }
  if (!target) {
    chrome.kill();
    console.error(`Chrome did not expose a DevTools target on port ${PORT}`);
    process.exit(2);
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  const httpErrors = [];
  const apiHosts = new Set();

  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
      return;
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      consoleErrors.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ")}`);
    }
    if (m.method === "Runtime.exceptionThrown") {
      consoleErrors.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
    }
    if (m.method === "Network.responseReceived") {
      const { status, url } = m.params.response;
      if (url.includes("/api/v1/")) apiHosts.add(new URL(url).origin);
      if (status >= 400 && !EXPECTED_HTTP.some((e) => e.split(/\s+/).every((part) => String(status).includes(part) || url.includes(part)))) {
        httpErrors.push(`HTTP ${status} ${url}`);
      }
    }
    if (m.method === "Network.loadingFailed" && !m.params.canceled) {
      httpErrors.push(`request failed: ${m.params.errorText} (${m.params.type})`);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  /** Closes the browser gracefully, then makes sure the process is gone. */
  const shutdown = async () => {
    try {
      await Promise.race([send("Browser.close"), sleep(2000)]);
    } catch {
      /* already closing */
    }
    try {
      ws.close();
    } catch {
      /* already closed */
    }
    for (let i = 0; i < 20; i++) {
      if (chrome.exitCode !== null || chrome.killed) break;
      chrome.kill(i < 10 ? "SIGTERM" : "SIGKILL");
      await sleep(200);
    }
  };

  return { chrome, send, consoleErrors, httpErrors, apiHosts, shutdown };
}

async function main() {
  log(`GeoRakshak browser smoke test\n  web: ${WEB_URL}\n  api: ${API_URL}\n  user: ${EMAIL}`);
  if (OUT_DIR) mkdirSync(OUT_DIR, { recursive: true });

  try {
    const health = await fetch(`${API_URL}/health`).then((r) => r.json());
    log(`  api health: ${JSON.stringify(health)}`);
  } catch (e) {
    console.error(`Cannot reach ${API_URL}/health: ${e.message}`);
    process.exit(2);
  }

  const { send, consoleErrors, httpErrors, apiHosts, shutdown } = await connect();
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`evaluate failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result?.value;
  };
  const sel = (testid) => `[data-testid="${testid}"]`;
  const query = (testid, prop = "textContent") => evaluate(`document.querySelector(${JSON.stringify(sel(testid))})?.${prop} ?? null`);
  const attr = (testid, name) => evaluate(`document.querySelector(${JSON.stringify(sel(testid))})?.getAttribute(${JSON.stringify(name)}) ?? null`);
  const count = (testid) => evaluate(`document.querySelectorAll(${JSON.stringify(sel(testid))}).length`);
  const click = (testid) =>
    evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel(testid))}); if (!el) return false; el.click(); return true; })()`);
  const shot = async (name) => {
    if (!OUT_DIR) return;
    const r = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT_DIR, name), Buffer.from(r.data, "base64"));
  };

  /** Waits until `check(value)` is true for the testid's property, else fails the step. */
  async function waitFor(label, read, check, timeoutMs = TIMEOUT_MS) {
    const started = Date.now();
    let last;
    while (Date.now() - started < timeoutMs) {
      last = await read();
      if (check(last)) return last;
      await sleep(300);
    }
    fail(`${label} (timed out after ${Math.round(timeoutMs / 1000)} s; last value: ${JSON.stringify(last)?.slice(0, 200)})`);
    return null;
  }

  try {
    await send("Runtime.enable");
    await send("Network.enable");
    await send("Page.enable");
    await send("Page.navigate", { url: WEB_URL });

    log("\n1. login");
    const formReady = await waitFor("login form did not render", () => evaluate(`!!document.querySelector('input[type=email]')`), Boolean, 20000);
    if (!formReady) throw new Error("no login form");
    await evaluate(`(() => {
      const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
      set(document.querySelector('input[type=email]'), ${JSON.stringify(EMAIL)});
      set(document.querySelector('input[type=password]'), ${JSON.stringify(PASSWORD)});
      document.querySelector('form').requestSubmit();
    })()`);
    await waitFor(
      "run mode never loaded after login",
      async () => ({ mode: await attr("run-mode-banner", "data-run-mode"), text: await query("run-mode-banner") }),
      (v) => !!v.mode,
    );
    const runMode = await attr("run-mode-banner", "data-run-mode");
    const banner = await query("run-mode-banner");
    if (banner) ok(`logged in · ${runMode} · ${banner.replace(/\s+/g, " ").trim().slice(0, 130)}`);
    const pilot = await query("pilot-name");
    if (pilot) ok(`pilot: ${pilot.trim()}`);
    else fail("pilot name missing from the header");

    log("\n2. map renders risk cells");
    await waitFor("map never became ready", () => attr("map", "data-map-ready"), (v) => v === "true");
    // An empty risk layer is a legitimate state (no replay started, no cycle yet); it must be labelled as such.
    const layerState = await waitFor(
      "risk layer neither loaded cells nor showed an empty state",
      async () => ({ features: await attr("map", "data-risk-features"), empty: await query("empty-risk") }),
      (v) => Number(v.features) > 0 || !!v.empty,
    );
    const hasCells = Number(layerState?.features ?? 0) > 0;
    if (!hasCells) {
      ok(`risk layer empty and labelled: ${layerState?.empty?.replace(/\s+/g, " ").trim()}`);
      notes.push("no risk assessments were loaded, so the cell, factor and forecast-source steps were skipped");
    } else {
      const renderedCells = await waitFor("risk cells never rendered on the map", () => attr("map", "data-risk-rendered"), (v) => Number(v) > 0);
      if (renderedCells) ok(`${layerState.features} cells in the layer, ${renderedCells} rendered`);
    }
    await shot("01-map.png");

    log("\n3. cell detail and factors");
    if (!hasCells) {
      ok("skipped (no assessed cells)");
    } else {
    await waitFor("no highest-risk cell entries to open", () => count("top-cell"), (n) => n > 0);
    if (!(await click("top-cell"))) fail("could not click a highest-risk cell");
    await waitFor("cell detail did not open", () => query("cell-detail"), (v) => !!v);
    const severity = await query("cell-severity");
    const factors = await waitFor("cell detail showed no factors", () => count("factor"), (n) => n > 0);
    const provenance = await count("provenance-badge");
    if (severity) ok(`severity ${severity.trim()}, ${factors} factors`);
    else fail("cell severity missing");
    if (provenance > 0) ok(`${provenance} provenance badges in the panel`);
    else fail("no provenance badges in the cell panel");
    const noAssessment = await query("no-assessment");
    if (noAssessment) notes.push(`cell detail reported: ${noAssessment.trim()}`);
    await shot("02-cell.png");
    }

    log("\n4. forecast lead time");
    if (!(await click("lead-48"))) fail("could not click the +48 h lead time");
    const forecast = await waitFor(
      "forecast banner did not settle at +48 h",
      async () => ({ text: await query("forecast-banner"), loading: await attr("forecast-banner", "data-loading") }),
      (v) => !!v.text && v.text.includes("+48 h") && v.loading === "false",
    ).then((v) => v?.text ?? null);
    if (forecast) {
      ok(`banner: ${forecast.trim().slice(0, 160)}`);
      if (/SIMULATED FORECAST/.test(forecast) && !/not a weather forecast/.test(forecast)) fail("simulated forecast banner does not say it is not a weather forecast");
      if (hasCells && /no forecast source reported/.test(forecast)) fail("risk layer has cells but reports no forecast source at +48 h");
      if (!/forecast skill/.test(forecast)) fail("forecast banner does not mention forecast skill");
    }
    await shot("03-forecast.png");
    if (!(await click("lead-0"))) fail("could not switch back to the current lead time");
    await waitFor("forecast banner did not clear when returning to current", () => query("forecast-banner"), (v) => v === null);

    log("\n5. land cover and rainfall evidence");
    if (!(await click("layer-landcover-toggle"))) {
      // The toggle is a checkbox inside the layer list; fall back to its label.
      await evaluate(`document.querySelector('[data-testid="layer-landcover"] input[type=checkbox]')?.click()`);
    }
    const landcover = await waitFor(
      "land-cover legend did not load",
      async () => ({ classes: await count("landcover-class"), empty: await query("landcover-empty"), acquisition: await query("landcover-acquisition") }),
      (v) => v.classes > 0 || !!v.empty,
    );
    if (landcover?.classes > 0) {
      const classList = await evaluate(`[...document.querySelectorAll('[data-testid="landcover-class"]')].map(e => e.innerText.replace(/\s+/g, " ").trim()).join(" | ")`);
      ok(`land-cover classes: ${classList}`);
      if (!landcover.acquisition || /not reported/.test(landcover.acquisition)) fail(`land-cover legend has no acquisition range: ${landcover.acquisition}`);
      else ok(landcover.acquisition.trim());
      const attribution = await query("landcover-attribution");
      if (attribution) ok(`attribution: ${attribution.trim().slice(0, 80)}`);
      else fail("land-cover attribution is missing");
      const layerCount = await attr("map", "data-landcover-features");
      if (Number(layerCount) > 0) ok(`${layerCount} land-cover cells in the layer`);
      else fail("land-cover layer has no features");
      const wording = await evaluate(`document.querySelector('[data-testid="landcover-legend"]').innerText`);
      if (!/not an image|not imagery/i.test(wording)) fail("land-cover wording does not make clear it is a derived class, not imagery");
    } else {
      ok(`land-cover legend empty state: ${landcover?.empty?.trim()}`);
    }
    if (hasCells) {
      const rain = await waitFor(
        "rainfall evidence did not load in the cell panel",
        async () => ({ bars: await attr("rainfall-bars", "data-bars"), empty: await query("rainfall-empty"), err: await query("error-box") }),
        (v) => !!v.bars || !!v.empty || !!v.err,
      );
      if (rain?.bars) {
        const obs = (await query("rainfall-observed"))?.replace(/\s+/g, " ").trim();
        const fc = (await query("rainfall-forecast"))?.replace(/\s+/g, " ").trim();
        ok(`rainfall bars: ${rain.bars} · ${obs} · ${fc}`);
        if (!/imd|meteo|mock|rainfall/i.test(obs ?? "")) fail("rainfall observed series does not name its source");
      } else if (rain?.empty) {
        ok(`rainfall empty state: ${rain.empty.trim()}`);
      } else {
        fail(`rainfall series failed to load: ${rain?.err?.trim()}`);
      }
    } else {
      ok("rainfall evidence skipped (no assessed cells)");
    }
    await shot("04-landcover.png");

    log("\n6. road status");
    await waitFor("no road segments listed", () => count("road-item"), (n) => n > 0);
    if (!(await click("road-item"))) fail("could not click a road segment");
    await waitFor("road detail did not open", () => query("road-detail"), (v) => !!v);
    const roadStatus = await query("road-status");
    const roadSource = await query("road-status-source");
    if (roadStatus && roadSource) ok(`road status ${roadStatus.trim()} · source ${roadSource.trim()}`);
    else fail(`road detail missing status (${roadStatus}) or status source (${roadSource})`);
    const legend = await evaluate(`document.body.innerText.includes("OPEN = no evidence of blockage")`);
    if (legend) ok("road legend keeps 'OPEN = no evidence of blockage'");
    else fail("road legend text 'OPEN = no evidence of blockage' is missing");
    await shot("04-road.png");

    log("\n7. alerts tab");
    if (!(await click("tab-alerts"))) fail("could not open the Alerts tab");
    const alertsState = await waitFor(
      "alerts tab showed neither a list nor an empty state",
      async () => ({ items: await count("alert-item"), empty: await query("empty-alerts") }),
      (v) => v.items > 0 || !!v.empty,
    );
    if (alertsState?.items > 0) {
      const tiers = await evaluate(`[...document.querySelectorAll('[data-testid="alert-tier"]')].map(e => e.getAttribute("data-tier")).join(",")`);
      if (tiers) ok(`${alertsState.items} alerts · tiers: ${tiers}`);
      else fail("alert list items do not show a tier");
    } else if (alertsState?.empty) {
      ok(`alerts list empty state: ${alertsState.empty.trim()}`);
      notes.push("no alerts existed, so tier rendering was not exercised");
    }
    if (alertsState?.items > 0) {
      if (!(await click("alert-item"))) fail("could not open an alert");
      const trail = await waitFor("audit trail did not load for the selected alert", async () => ({
        events: await count("audit-event"),
        empty: await query("empty-audit"),
      }), (v) => v.events > 0 || !!v.empty);
      if (trail?.events > 0) {
        const actors = await evaluate(`[...document.querySelectorAll('[data-testid="audit-event"]')].map(e => e.getAttribute("data-action") + ":" + e.getAttribute("data-actor")).join(", ")`);
        ok(`audit trail: ${actors}`);
      } else if (trail?.empty) {
        ok(`audit trail empty state: ${trail.empty.trim()}`);
      }
    }
    await shot("05-alerts.png");

    log("\n8. data-in-view strip");
    const strip = await evaluate(`(() => {
      const out = {};
      for (const el of document.querySelectorAll('[data-testid^="strip-"]')) out[el.getAttribute("data-testid")] = el.innerText.replace(/\\s+/g, " ").trim();
      return out;
    })()`);
    const entry = (key) => strip?.[`strip-${key}`] ?? null;
    for (const key of ["terrain", "landslides", "roads", "facilities", "rainfall", "forecast", "soil", "sms", "push", "model"]) {
      const text = entry(key);
      if (!text) fail(`data strip entry "${key}" is missing`);
      else if (/not loaded|Run mode not loaded/i.test(text)) fail(`data strip entry "${key}" never loaded: ${text}`);
      else ok(`${key}: ${text}`);
    }
    const checks = [
      ["rainfall", /Replay of real historical .* rainfall|Simulated rainfall|Replay not started|REAL_LIVE|REAL_HISTORICAL/],
      ["forecast", /not a weather forecast|REAL_LIVE|no forecast source reported/],
      ["soil", /Virtual sensors \(simulated\)|REAL_LIVE/],
      ["sms", /Sandbox — not sent|Not connected|Connected|Simulated — not sent/],
      ["model", /no validated accuracy|No model registered|[A-Za-z_]+ \d\.\d/],
    ];
    for (const [key, re] of checks) {
      const text = entry(key);
      if (text && !re.test(text)) fail(`data strip entry "${key}" is not an expected honest label: ${text}`);
    }
    const modelChip = await query("model-chip");
    if (modelChip) ok(`model chip: ${modelChip.trim()}`);
    else fail("model chip missing from the header");
    await shot("06-strip.png");

    log("\n9. monitoring cycle and weather (inside the System status panel)");
    if (!(await query("status-counts"))) {
      if (!(await click("open-system-status"))) fail("could not open the System status panel");
    }
    await waitFor("monitoring block did not render inside the System status panel", () => query("monitoring-panel"), (v) => !!v);
    const health = await attr("monitor-scheduler", "data-health");
    const scheduler = (await query("monitor-scheduler"))?.replace(/\s+/g, " ").trim();
    const detail = (await query("monitor-detail"))?.replace(/\s+/g, " ").trim();
    if (health) ok(`scheduler: ${health} · ${scheduler} · ${detail}`);
    else fail("monitoring panel does not report a scheduler health state");
    if (runMode === "DEMO_REPLAY") {
      if (health !== "NO_SCHEDULER") fail(`DEMO_REPLAY should report NO_SCHEDULER, got ${health}`);
      if (!detail) fail("DEMO_REPLAY does not explain that cycles run on replay steps");
      if (await query("monitor-run-cycle")) fail("'Run cycle now' is offered in DEMO_REPLAY, where it returns 409");
    } else {
      if (!["OK", "FAILED", "STALE", "STOPPED", "NEVER_RUN"].includes(String(health))) fail(`unexpected scheduler health in LIVE: ${health}`);
      const lastRun = await query("monitor-last-run");
      const nextRun = await query("monitor-next-run");
      const lastSuccess = await query("monitor-last-success");
      if (lastRun && nextRun) ok(`last run: ${lastRun.trim()} · next run: ${nextRun.trim()}`);
      else fail(`monitoring panel missing last run (${lastRun}) or next run (${nextRun})`);
      if (lastSuccess) ok(`last success: ${lastSuccess.trim()}`);
      else fail("monitoring panel does not show the last successful cycle");
    }
    const provider = await query("monitor-weather-provider");
    const weatherPanel = (await query("monitor-weather"))?.replace(/\s+/g, " ").trim();
    if (provider) ok(`weather provider: ${provider.trim()}${(await query("monitor-weather-imd")) ? ` · ${(await query("monitor-weather-imd")).trim()}` : ""}`);
    else fail("weather provider is not shown");
    if (provider?.includes("No weather provider connected")) {
      if (!/replay|stored history/i.test(weatherPanel ?? "")) fail("no-provider state does not say where rainfall comes from");
      else ok("no-provider state names the replay/stored-history fallback");
    } else {
      for (const role of ["observed", "forecast"]) {
        const row = await query(`weather-row-${role}`);
        if (row) ok(`${role} source: ${row.replace(/\s+/g, " ").trim().slice(0, 140)}`);
        else fail(`weather ${role} source row is missing`);
      }
      const counts = await query("monitor-weather-counts");
      if (counts) ok(`ingest counts: ${counts.trim()}`);
      else fail("last ingest counts are missing");
    }
    const weatherError = await query("monitor-weather-error");
    if (weatherError) notes.push(`weather error shown: ${weatherError.trim()}`);
    const warning = await query("monitor-warning");
    const shouldWarn = ["FAILED", "STALE", "STOPPED", "NEVER_RUN"].includes(String(health));
    if (shouldWarn && !warning) fail(`scheduler health is ${health} but no warning is shown next to the map`);
    if (!shouldWarn && warning) fail(`a monitoring warning is shown although health is ${health}: ${warning.trim()}`);
    if (warning) {
      ok(`map warning: ${warning.replace(/\s+/g, " ").trim().slice(0, 160)}`);
      if (!/out of date|stopped|not run yet/i.test(warning)) fail("the monitoring warning does not say the displayed risk may be out of date");
    } else if (health === "OK") {
      ok("no monitoring warning (last cycle OK)");
    }
    const rainfallTag = entry("rainfall");
    const expectTag = runMode === "DEMO_REPLAY" ? /REAL_REPLAY|SIMULATED|NOT STARTED/ : /REAL_LIVE|REAL_HISTORICAL|NOT_CONNECTED|AWAITING_ACCESS/;
    if (rainfallTag && !expectTag.test(rainfallTag)) fail(`rainfall strip label does not match ${runMode}: ${rainfallTag}`);
    const tones = await evaluate(`(() => { const out = {}; for (const el of document.querySelectorAll('[data-testid^="strip-"]')) { const t = [...el.classList].find(c => c.startsWith("tone-")); if (t) out[el.getAttribute("data-testid")] = t; } return out; })()`);
    ok(`strip tones: ${Object.entries(tones ?? {}).map(([k, v]) => `${k.replace("strip-", "")}=${v.replace("tone-", "")}`).join(", ")}`);
    if (new Set(Object.values(tones ?? {})).size < 3) fail("the data strip does not visually separate live, historical/simulated and unavailable sources");

    log("\n10. system status panel");
    if (!(await query("status-counts"))) {
      if (!(await click("open-system-status"))) fail("could not open the System status panel");
    }
    await waitFor("System status panel did not open", () => query("status-counts"), (v) => !!v);
    const counts = (await query("status-counts"))?.trim();
    if (counts && /\d+ (real live|real replay|real historical|simulated|sandbox|awaiting access|not connected)/.test(counts)) ok(`counts: ${counts}`);
    else fail(`status counts line missing or not in the display vocabulary: ${counts}`);
    const statusMode = await query("status-run-mode");
    const expectedMode = runMode === "DEMO_REPLAY" ? "REPLAY" : "LIVE";
    if (statusMode?.trim() === expectedMode) ok(`mode: ${statusMode.trim()}${runMode === "DEMO_REPLAY" ? ` · ${(await query("status-replay"))?.trim()}` : ""}`);
    else fail(`status panel mode reads ${statusMode}, expected ${expectedMode}`);
    if (await query("status-pilot")) ok(`pilot: ${(await query("status-pilot"))?.replace(/\s+/g, " ").trim()}`);
    else fail("status panel does not name the pilot");
    const headline = (await query("weather-headline"))?.trim();
    if (headline && /IMD/.test(headline)) ok(`weather: ${headline}`);
    else fail(`weather headline does not state IMD vs fallback: ${headline}`);
    const groupKeys = await evaluate(`[...document.querySelectorAll('[data-testid="status-group"]')].map(e => e.getAttribute("data-group")).join(",")`);
    const expectedGroups = "imd-weather,weather-fallback,satellite,sensor,inventory,terrain,exposure,notification";
    if (groupKeys?.startsWith(expectedGroups)) ok(`groups: ${groupKeys}`);
    else fail(`status groups are ${groupKeys}, expected ${expectedGroups}`);
    const rowLabels = await evaluate(`[...document.querySelectorAll('[data-testid="status-adapter"]')].map(e => e.getAttribute("data-label"))`);
    const vocabulary = ["REAL_LIVE", "REAL_REPLAY", "REAL_HISTORICAL", "SIMULATED", "SANDBOX", "AWAITING_ACCESS", "NOT_CONNECTED"];
    const offVocabulary = (rowLabels ?? []).filter((l) => !vocabulary.includes(l));
    if ((rowLabels ?? []).length > 0 && offVocabulary.length === 0) ok(`${rowLabels.length} source rows, all in the seven-value vocabulary`);
    else fail(`source rows off the vocabulary: ${offVocabulary.join(", ") || "no rows rendered"}`);
    const imdRows = await evaluate(`[...document.querySelectorAll('[data-group="imd-weather"] [data-testid="status-adapter"]')].map(e => e.getAttribute("data-slug") + ":" + e.getAttribute("data-label")).join(", ")`);
    if (imdRows && !/open-meteo/.test(imdRows)) ok(`IMD weather rows: ${imdRows}`);
    else fail(`IMD weather group is wrong: ${imdRows}`);
    const markers = await evaluate(`[...document.querySelectorAll('[data-testid="licence-marker"]')].map(e => e.closest('[data-testid="status-adapter"]').getAttribute("data-slug") + ":" + e.getAttribute("data-marker")).join(", ")`);
    if (/imd-gridded-rainfall:permission-required/.test(markers ?? "") && /gsi-bhusanket:permission-required/.test(markers ?? "")) ok(`licence markers: ${markers}`);
    else notes.push(`licence markers seen: ${markers || "none"}`);
    const labelLegend = await evaluate(`[...document.querySelectorAll('[data-testid="label-legend-item"]')].map(e => e.getAttribute("data-label")).join(",")`);
    if (labelLegend === vocabulary.join(",")) ok("legend lists the seven labels in order, each with its meaning");
    else fail(`label legend is ${labelLegend}`);
    const stripTags = await evaluate(`[...document.querySelectorAll('[data-testid^="strip-"] .strip-tag')].map(e => e.textContent.trim())`);
    const stripOff = (stripTags ?? []).filter((t) => !vocabulary.includes(t) && !["MODEL_OUTPUT", "UNKNOWN", "NOT STARTED", "NONE", "NOT REPORTED"].includes(t));
    if (stripOff.length === 0) ok(`data strip tags share the vocabulary: ${[...new Set(stripTags)].join(", ")}`);
    else fail(`data strip tags outside the vocabulary: ${stripOff.join(", ")}`);
    await shot("07-system-status.png");
    await evaluate(`document.querySelector('[data-testid="system-status"]').scrollTop = 99999`);
    await evaluate(`document.querySelector('.drawer-body').scrollTop = 99999`);
    await shot("08-system-status-bottom.png");
    if (!(await click("close-system-status"))) fail("could not close the System status panel");
    await waitFor("System status panel did not close", () => query("system-status"), (v) => v === null);

    log("\n11. page health");
    if (apiHosts.size && !apiHosts.has(new URL(API_URL).origin)) {
      fail(`the dashboard called ${[...apiHosts].join(", ")}, not ${new URL(API_URL).origin} — check VITE_API_BASE_URL`);
    } else if (apiHosts.size) {
      ok(`API calls went to ${[...apiHosts].join(", ")}`);
    }
    if (consoleErrors.length) consoleErrors.forEach((e) => fail(e));
    else ok("no console errors");
    if (httpErrors.length) httpErrors.forEach((e) => fail(e));
    else ok(`no unexpected HTTP failures (allowed: ${EXPECTED_HTTP.join(", ") || "none"})`);
  } catch (e) {
    fail(`aborted: ${e.message}`);
  } finally {
    await shutdown();
  }

  if (notes.length) log(`\nnotes:\n${notes.map((n) => `  - ${n}`).join("\n")}`);
  if (failures.length) {
    log(`\nFAILED (${failures.length}):\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  log("\nPASSED");
  process.exit(0);
}

await main();

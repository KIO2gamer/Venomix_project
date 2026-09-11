// Drives the dashboard end to end: alert acknowledgement, incident report, CSV import.
export default async function run(page, ui) {
  const result = {};
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));

  // --- Acknowledge an alert from the Alert rules workspace -------------------
  const initial = await ui.snapshot();
  result.ackBadgeBefore = initial.match(/button "Alert rules (\d+)"/)?.[1] ?? "none";
  const alertRulesRef = initial.match(/@(e\d+) button "Alert rules/)[1];
  await ui.click(alertRulesRef);
  await page.waitForTimeout(800);

  const alertView = await ui.snapshot();
  const ackRef = alertView.match(/@(e\d+) button "Acknowledge"/)?.[1];
  if (!ackRef) return { error: "no acknowledge button", alertView, errors };
  await ui.click(ackRef);
  await page.waitForTimeout(1500);
  const afterAck = await ui.snapshot();
  result.ackBadgeAfter = afterAck.match(/button "Alert rules (\d+)"/)?.[1] ?? "none";
  result.acknowledgedRows = (await page.getByText("Acknowledged").count()) > 0;

  // --- Submit an incident report with a real payload -------------------------
  const overview = await ui.snapshot();
  await ui.click(overview.match(/@(e\d+) button "Report incident"/)[1]);
  await page.waitForTimeout(500);
  const modal = await ui.snapshot({ full: true });
  result.modalOpen = modal.includes("Report an incident");
  const noteField = page.locator(".modal textarea").first();
  await noteField.waitFor({ state: "visible", timeout: 10000 });
  await noteField.fill(
    "Automated QA: culvert washed out near the Assam border checkpoint.",
  );
  const modalRefs = await ui.snapshot();
  await ui.click(modalRefs.match(/@(e\d+) button "Submit report"/)[1]);
  await page.waitForFunction(() => document.body.innerText.includes("Report queued"), null, {
    timeout: 8000,
  });
  result.reportAccepted = true;
  const successRefs = await ui.snapshot();
  await ui.click(successRefs.match(/@(e\d+) button "Done"/)[1]);
  await page.waitForTimeout(1500);

  // The new report must appear in the field reports feed.
  const nav = await ui.snapshot();
  await ui.click(nav.match(/@(e\d+) button "Field reports"/)[1]);
  await page.waitForTimeout(1200);
  result.reportInFeed = (await page.locator("table").innerText()).includes("Automated QA");

  // --- CSV import: 12 plottable rows, all of them mapped ----------------------
  const nav2 = await ui.snapshot();
  await ui.click(nav2.match(/@(e\d+) button "Data sources"/)[1]);
  await page.waitForTimeout(800);
  const csv = ["name,latitude,longitude,risk"]
    .concat(Array.from({ length: 12 }, (_, i) => `QA Point ${i},${20 + i},${90 + i},${i * 5}`))
    .join("\n") + "\n";
  await page.setInputFiles('input[type="file"]', {
    name: "qa-points.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });
  await page.waitForFunction(() => document.body.innerText.includes("ready to plot"), null, {
    timeout: 10000,
  });
  const summaryText = await page.locator(".import-summary").innerText();
  result.csvSummary = summaryText;
  result.csvPlotsEveryRow = summaryText.includes("12 of 12");

  // The imported points must actually reach the map component.
  const nav3 = await ui.snapshot();
  await ui.click(nav3.match(/@(e\d+) button "Overview"/)[1]);
  await page.waitForTimeout(2500);
  result.mapBadge = await page.locator(".map-data-badge").innerText();
  result.consoleErrors = errors;

  return result;
}

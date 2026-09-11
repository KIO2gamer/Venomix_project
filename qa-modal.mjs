// Does the Report incident modal expose a visible textarea?
export default async function run(page, ui) {
  const before = await ui.snapshot();
  const reportRef = before.match(/@(e\d+) button "Report incident"/)?.[1];
  if (!reportRef) return { error: "no Report incident button", snapshot: before };

  await ui.click(reportRef);
  await page.waitForTimeout(800);
  const textarea = page.locator("textarea").first();
  return {
    textareaCount: await page.locator("textarea").count(),
    visible: await textarea.isVisible(),
    box: await textarea.boundingBox().catch(() => null),
    placeholder: await textarea.getAttribute("placeholder").catch(() => null),
    modalOpen: (await page.locator(".modal").count()) > 0,
  };
}

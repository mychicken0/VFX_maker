import type { Page } from "@playwright/test";
/** Existing authoring flows explicitly open optional panels; fresh defaults are
 * exercised separately in usability.spec.ts. Use the same controls as an artist. */
export async function editingWorkspace(page: Page) {
  if (
    !(await page
      .locator(".studio")
      .evaluate((el) => el.classList.contains("compact")))
  ) {
    const library = page.getByRole("button", { name: "Library", exact: true });
    if ((await library.getAttribute("aria-pressed")) === "false")
      await library.click();
    const controls = page.locator(".effect-controls > summary");
    if (
      (await controls.isVisible()) &&
      !(await page.locator(".effect-controls").getAttribute("open"))
    )
      await controls.click();
  }
}
export async function openSection(page: Page, text: string) {
  const summary = page
    .locator(".inspector-scroll summary")
    .filter({ hasText: new RegExp(`^${text}$`) })
    .first();
  if (
    (await summary.isVisible()) &&
    (await summary.locator("..").getAttribute("open")) === null
  )
    await summary.click();
}

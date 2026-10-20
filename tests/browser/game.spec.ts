import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { SupabaseBrowserHarness } from "./supabase-harness";

test("két mobilböngésző: élő lobby, teljes kör, visszatérés, győzelem és új parti", async ({ browser }, testInfo) => {
  const harness = new SupabaseBrowserHarness();
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  await harness.initialize();
  async function phone() {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    contexts.push(context);
    await harness.attach(context);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:3100");
    return page;
  }
  async function noHorizontalOverflow(page: Page) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  try {
    const first = await phone();
    const second = await phone();
    await expect(first.getByRole("heading", { name: /Az élet szívás/ })).toBeVisible();
    await first.screenshot({ path: testInfo.outputPath("join-mobile.png"), fullPage: true });
    await first.getByLabel("Hogy szólítsunk?").fill("Ádám");
    await first.getByRole("button", { name: "Csatlakozás", exact: true }).click();
    await second.getByLabel("Hogy szólítsunk?").fill("Lili");
    await second.getByRole("button", { name: "Csatlakozás", exact: true }).click();
    for (const page of [first, second]) {
      await expect(page.getByText("2 játékos", { exact: true })).toBeVisible();
      await expect(page.getByText("Élő asztal", { exact: true })).toBeVisible();
      await noHorizontalOverflow(page);
    }
    await first.screenshot({ path: testInfo.outputPath("lobby-mobile.png"), fullPage: true });
    await first.setViewportSize({ width: 1280, height: 900 });
    await noHorizontalOverflow(first);
    await first.screenshot({ path: testInfo.outputPath("lobby-desktop.png"), fullPage: true });
    await first.setViewportSize({ width: 390, height: 844 });
    await first.getByRole("button", { name: "Játék indítása", exact: true }).click();
    for (const page of [first, second]) {
      for (let i = 0; i < 3; i++) {
        await expect(page.getByRole("slider")).toBeVisible();
        if (i === 0) {
          await page.getByRole("slider").press("ArrowRight");
          await expect(page.locator("output")).toHaveText("51");
          await page.getByRole("slider").press("ArrowLeft");
        }
        await page.getByRole("button", { name: "Pontszám véglegesítése", exact: true }).click();
        // A következő lap nem ugyanaz a form: megvárjuk az RPC-t és az új snapshotot.
        if (i < 2) await expect(page.getByText(`Kezdőkártya · ${i + 2}/3`, { exact: true })).toBeVisible();
      }
      if (page === first) await expect(page.getByText("Várakozás a többi játékosra...", { exact: true })).toBeVisible();
    }
    await expect(first.getByText("1. kör ·", { exact: false })).toBeVisible();
    const firstIsActive = await first.getByRole("heading", { name: "Hová fér még egy szar ügy?", exact: true }).isVisible();
    const active = firstIsActive ? first : second;
    const voter = firstIsActive ? second : first;
    const finalize = () => active.getByRole("button", { name: "Elhelyezés véglegesítése", exact: true });
    await expect(finalize()).toBeDisabled();
    await active.getByRole("button", { name: "Elhelyezés: 50 elé", exact: true }).click();
    await expect(active.getByRole("button", { name: "Elhelyezés: 50 elé", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(finalize()).toBeDisabled();
    await active.reload();
    await expect(active.getByRole("button", { name: "Elhelyezés: 50 elé", exact: true })).toHaveAttribute("aria-pressed", "true");
    await voter.getByRole("button", { name: "Értékelés beküldése", exact: true }).click();
    await expect(voter.getByRole("heading", { name: "Pontszám elküldve.", exact: true })).toBeVisible();
    await expect(finalize()).toBeEnabled();
    await noHorizontalOverflow(active);
    await active.screenshot({ path: testInfo.outputPath("active-mobile.png"), fullPage: true });
    await finalize().click();
    for (const page of [first, second]) {
      await expect(page.getByRole("table")).toBeVisible();
      await expect(page.getByRole("cell", { name: "50,0", exact: true })).toBeVisible();
      await expect(page.getByText("2. kör ·", { exact: false })).toBeVisible();
      await noHorizontalOverflow(page);
    }
    await first.screenshot({ path: testInfo.outputPath("result-mobile.png"), fullPage: true });
    await contexts[1].setOffline(true);
    await expect(second.getByText(/Megszakadt a kapcsolat\. A lapjaid megmaradnak/)).toBeVisible();
    harness.disconnectChannels(harness.users[1]);
    await contexts[1].setOffline(false);
    await expect(second.getByText("Élő asztal", { exact: true })).toBeVisible();
    await second.reload();
    await expect(second.getByText("2. kör ·", { exact: false })).toBeVisible();
    const late = await phone();
    await expect(late.getByRole("heading", { name: "Ez az asztal most foglalt.", exact: true })).toBeVisible();
    await expect(late.getByLabel("Hogy szólítsunk?")).toHaveCount(0);
    while ((await harness.state()).players.some((player) => player.card_count < 9)) await harness.advanceRound();
    for (const page of [first, second]) await expect(page.getByText("9/10 lap", { exact: true })).toBeVisible();
    const nineCardActive = await first.getByRole("heading", { name: "Hová fér még egy szar ügy?", exact: true }).isVisible() ? first : second;
    await expect(nineCardActive.getByRole("button", { name: /^Elhelyezés:/ })).toHaveCount(10);
    await noHorizontalOverflow(nineCardActive);
    await nineCardActive.screenshot({ path: testInfo.outputPath("nine-cards-mobile.png"), fullPage: true });
    await harness.finishGame();
    for (const page of [first, second]) {
      await expect(page.getByRole("heading", { name: /nyert!$/ })).toBeVisible();
      await expect(page.getByText("10 lap", { exact: true })).toBeVisible();
      await noHorizontalOverflow(page);
    }
    await first.screenshot({ path: testInfo.outputPath("winner-mobile.png"), fullPage: true });
    await first.getByRole("button", { name: "Új játék – vissza a váróba", exact: true }).click();
    await expect(first.getByText("1 játékos", { exact: true })).toBeVisible();
    await expect(second.getByLabel("Hogy szólítsunk?")).toHaveValue("Lili");
    await second.getByRole("button", { name: "Csatlakozás", exact: true }).click();
    await expect(first.getByText("2 játékos", { exact: true })).toBeVisible();
    expect((await harness.state()).my_cards).toHaveLength(0);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await harness.db.close();
  }
});

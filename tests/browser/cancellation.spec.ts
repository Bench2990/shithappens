import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { SupabaseBrowserHarness } from "./supabase-harness";

test("mobilos megszakítás: megerősítés, kezdőpontozás, várakozás, új parti és párhuzamos kérések", async ({ browser }, testInfo) => {
  const harness = new SupabaseBrowserHarness();
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  await harness.initialize();

  async function phone(nickname: string) {
    const context = await browser.newContext({ viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true });
    contexts.push(context);
    await harness.attach(context);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:3100");
    await page.getByLabel("Hogy szólítsunk?").fill(nickname);
    await page.getByRole("button", { name: "Csatlakozás", exact: true }).click();
    await expect(page.getByText("Élő asztal", { exact: true })).toBeVisible();
    return page;
  }
  const cancelButton = (page: Page) => page.getByRole("button", { name: "Játék megszakítása", exact: true });
  const dialog = (page: Page) => page.getByRole("dialog", { name: "Biztosan megszakítod a játékot?", exact: true });
  async function rateInitial(page: Page) {
    for (let slot = 0; slot < 3; slot++) {
      await expect(page.getByText(`Kezdőkártya · ${slot + 1}/3`, { exact: true })).toBeVisible();
      await expect(page.locator("output")).toHaveText("50");
      await page.getByRole("button", { name: "Pontszám véglegesítése", exact: true }).click();
    }
  }
  async function lobby(page: Page, by: string) {
    // A biztonsági, 12 másodperces polling helyett a Realtime-jelzésnek kell idehoznia.
    await expect(page.getByRole("button", { name: "Játék indítása", exact: true })).toBeEnabled({ timeout: 5_000 });
    await expect(page.getByText(`A partit megszakította: ${by}. Visszatértetek a lobbyba.`, { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Játékosok" })).toContainText("Bence");
    await expect(page.getByRole("region", { name: "Játékosok" })).toContainText("Lili");
    await expect(page.getByLabel("Hogy szólítsunk?")).toHaveCount(0);
    await expect(cancelButton(page)).toHaveCount(0);
    await expect(dialog(page)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  try {
    const first = await phone("Bence");
    const second = await phone("Lili");
    for (const page of [first, second]) await expect(cancelButton(page)).toHaveCount(0);
    await first.getByRole("button", { name: "Játék indítása", exact: true }).click();
    await expect(cancelButton(first)).toBeVisible();
    const original = await harness.state();
    const buttonSize = await cancelButton(first).boundingBox();
    expect(buttonSize!.height).toBeGreaterThanOrEqual(44);
    await first.getByRole("slider").press("ArrowRight");
    await cancelButton(first).click();
    await expect(dialog(first)).toBeVisible();
    await expect(dialog(first).getByText("A jelenlegi parti véget ér, minden játékos visszakerül a lobbyba, és az aktuális kártyák és pontszámok elvesznek az új játék szempontjából.", { exact: true })).toBeVisible();
    await expect(dialog(first).getByRole("button", { name: "Mégse", exact: true })).toBeFocused();
    await first.screenshot({ path: testInfo.outputPath("cancel-dialog-mobile.png"), fullPage: true });
    expect(await first.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await dialog(first).getByRole("button", { name: "Mégse", exact: true }).click();
    await expect(dialog(first)).not.toBeVisible();
    await expect(first.locator("output")).toHaveText("51");
    expect(await harness.state()).toEqual(original);
    await cancelButton(first).click();
    await first.keyboard.press("Escape");
    await expect(dialog(first)).not.toBeVisible();
    await expect(cancelButton(first)).toBeFocused();
    await first.getByRole("slider").press("ArrowLeft");

    await rateInitial(first);
    await expect(first.getByText("Várakozás a többi játékosra...", { exact: true })).toBeVisible();
    await expect(second.getByText("Kezdőkártya · 1/3", { exact: true })).toBeVisible();
    await cancelButton(second).click();
    await cancelButton(first).click();
    await dialog(first).getByRole("button", { name: "Játék megszakítása", exact: true }).click();
    for (const page of [first, second]) await lobby(page, "Bence");
    const freshLobby = await harness.state();
    expect(freshLobby.game.id).not.toBe(original.game.id);
    expect(freshLobby.my_cards).toEqual([]);
    expect(freshLobby.players.every((p) => p.card_count === 0 && p.initial_rated === 0)).toBe(true);

    // A másik résztvevő újracsatlakozás és frissítés nélkül indíthat.
    await second.getByRole("button", { name: "Játék indítása", exact: true }).click();
    for (const page of [first, second]) {
      await expect(page.getByText(/A partit megszakította:/)).toHaveCount(0);
      await rateInitial(page);
    }
    await expect(first.getByText("1. kör ·", { exact: false })).toBeVisible();
    const playing = await harness.state();
    expect(playing.current_round!.ratings_count).toBe(0);
    expect(playing.current_round!.selected_position).toBeNull();
    expect(playing.latest_result).toBeNull();
    const firstIsActive = await first.getByRole("heading", { name: "Hová fér még egy szar ügy?", exact: true }).isVisible();
    const active = firstIsActive ? first : second;
    const voter = firstIsActive ? second : first;
    const voterName = firstIsActive ? "Lili" : "Bence";
    await cancelButton(active).click();
    await active.keyboard.press("Escape");
    await cancelButton(voter).click();
    await dialog(voter).getByRole("button", { name: "Mégse", exact: true }).click();
    await voter.getByRole("button", { name: "Értékelés beküldése", exact: true }).click();
    await expect(voter.getByRole("heading", { name: "Pontszám elküldve.", exact: true })).toBeVisible();
    await cancelButton(voter).click();
    await dialog(voter).getByRole("button", { name: "Játék megszakítása", exact: true }).click();
    for (const page of [first, second]) await lobby(page, voterName);

    await first.getByRole("button", { name: "Játék indítása", exact: true }).click();
    const countBefore = (await harness.db.query("select * from public.games")).rows.length;
    for (const page of [first, second]) await cancelButton(page).click();
    let requests = 0;
    let release!: () => void;
    const bothRequests = new Promise<void>((resolve) => { release = resolve; });
    for (const page of [first, second]) await page.route("**/rest/v1/rpc/cancel_game", async (route) => {
      if (++requests === 2) release();
      await bothRequests;
      await route.fallback();
    });
    await Promise.all([first, second].map((page) => dialog(page).getByRole("button", { name: "Játék megszakítása", exact: true }).click()));
    for (const page of [first, second]) await expect(page.getByRole("button", { name: "Játék indítása", exact: true })).toBeEnabled();
    const cancelled = await harness.state();
    for (const page of [first, second]) await lobby(page, cancelled.cancellation!.nickname);
    expect((await harness.db.query("select * from public.games")).rows).toHaveLength(countBefore + 1);
    expect(cancelled.player_count).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await harness.db.close();
  }
});

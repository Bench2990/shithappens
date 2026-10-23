import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { SupabaseBrowserHarness } from "./supabase-harness";

test("három mobil: kilépés, új becenév, közös lobbycsere, játék és párhuzamos reset", async ({ browser }, testInfo) => {
  const harness = new SupabaseBrowserHarness();
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  const signUps: number[] = [];
  let logouts = 0;
  await harness.initialize();

  async function join(page: Page, nickname: string) {
    await page.getByLabel("Hogy szólítsunk?").fill(nickname);
    await page.getByRole("button", { name: "Csatlakozás", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Mindenki itt van?", exact: true })).toBeVisible();
  }
  async function phone(nickname: string) {
    const index = contexts.length;
    signUps[index] = 0;
    const context = await browser.newContext({ viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true });
    contexts.push(context);
    await harness.attach(context);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      const path = new URL(request.url()).pathname;
      if (path === "/auth/v1/signup") signUps[index]++;
      if (path === "/auth/v1/logout") logouts++;
    });
    await page.goto("http://127.0.0.1:3100");
    await join(page, nickname);
    await expect(page.getByText("Élő asztal", { exact: true })).toBeVisible();
    return page;
  }
  const leave = (page: Page) => page.getByRole("button", { name: "Kilépés a lobbiból", exact: true });
  const reset = (page: Page) => page.getByRole("button", { name: "Új lobby létrehozása", exact: true });
  const dialog = (page: Page) => page.getByRole("dialog", { name: "Biztosan új lobbyt szeretnél létrehozni?", exact: true });
  const players = (page: Page) => page.getByRole("region", { name: "Játékosok" });
  async function joinScreen(page: Page) {
    // Az 5 s rövidebb a 12 s-os biztonsági pollingnál: Realtime-frissítés kell.
    await expect(page.getByLabel("Hogy szólítsunk?")).toBeVisible({ timeout: 5_000 });
    await expect(leave(page)).toHaveCount(0);
    await expect(reset(page)).toHaveCount(0);
    await expect(dialog(page)).toHaveCount(0);
  }
  async function noOverflow(page: Page) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  const identity = (page: Page) => page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => name.endsWith("-auth-token"));
    return key ? JSON.parse(localStorage.getItem(key)!).user.id as string : null;
  });

  try {
    const first = await phone("Bence");
    const second = await phone("Lili");
    const third = await phone("Ádám");
    const pages = [first, second, third];
    for (const page of pages) {
      await expect(players(page).getByRole("listitem")).toHaveCount(3);
      await expect(leave(page)).toBeEnabled();
      await expect(reset(page)).toBeEnabled();
      expect((await leave(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await reset(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await noOverflow(page);
    }
    const identities = await Promise.all(pages.map(identity));
    const original = await harness.state();
    await first.screenshot({ path: testInfo.outputPath("lobby-actions-mobile.png"), fullPage: true });

    await leave(second).click();
    await joinScreen(second);
    await expect(second.getByLabel("Hogy szólítsunk?")).toHaveValue("Lili");
    for (const page of [first, third]) {
      await expect(players(page).getByRole("listitem")).toHaveCount(2, { timeout: 5_000 });
      await expect(players(page)).not.toContainText("Lili");
      await expect(leave(page)).toBeEnabled();
    }
    expect((await harness.state(harness.users[1])).me_id).toBeNull();
    expect((await harness.state()).players.map((p) => p.id)).toEqual([original.players[0].id, original.players[2].id]);
    await join(second, "Nóri");
    for (const page of pages) await expect(players(page)).toContainText("Nóri");
    expect(await identity(second)).toBe(identities[1]);

    const beforeReset = await harness.state();
    await reset(third).click();
    await expect(dialog(third)).toBeVisible();
    await expect(dialog(third).getByText("A jelenlegi lobby megszűnik, minden játékos kikerül belőle, és újra csatlakozhattok egy üres lobbyhoz.", { exact: true })).toBeVisible();
    await expect(dialog(third).getByRole("button", { name: "Mégse", exact: true })).toBeFocused();
    await third.screenshot({ path: testInfo.outputPath("reset-dialog-mobile.png"), fullPage: true });
    await noOverflow(third);
    await dialog(third).getByRole("button", { name: "Mégse", exact: true }).click();
    await expect(dialog(third)).not.toBeVisible();
    expect(await harness.state()).toEqual(beforeReset);
    await reset(third).click();
    await third.keyboard.press("Escape");
    await expect(dialog(third)).not.toBeVisible();
    await expect(reset(third)).toBeFocused();

    // A másik telefonon nyitva hagyott ablakot is bezárja a lobbyváltás.
    await reset(first).click();
    await reset(third).click();
    await dialog(third).getByRole("button", { name: "Új lobby létrehozása", exact: true }).click();
    for (const page of pages) await joinScreen(page);
    const empty = await harness.state();
    expect(empty.game.id).not.toBe(original.game.id);
    expect(empty.player_count).toBe(0);
    expect(empty.players).toEqual([]);
    for (const user of harness.users) expect((await harness.state(user)).me_id).toBeNull();

    await join(first, "Bence");
    await join(second, "Nóri");
    await join(third, "Dani");
    await second.getByRole("button", { name: "Játék indítása", exact: true }).click();
    for (const page of pages) {
      await expect(page.getByText("Kezdőkártya · 1/3", { exact: true })).toBeVisible();
      await expect(leave(page)).toHaveCount(0);
      await expect(reset(page)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Játék megszakítása", exact: true })).toBeVisible();
      for (let slot = 0; slot < 3; slot++) {
        await expect(page.getByText(`Kezdőkártya · ${slot + 1}/3`, { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Pontszám véglegesítése", exact: true }).click();
      }
    }
    for (const page of pages) {
      await expect(page.getByText("1. kör ·", { exact: false })).toBeVisible();
      await expect(leave(page)).toHaveCount(0);
      await expect(reset(page)).toHaveCount(0);
    }
    await harness.advanceRound();
    await expect(first.getByText("2. kör ·", { exact: false })).toBeVisible();
    await first.getByRole("button", { name: "Játék megszakítása", exact: true }).click();
    await first.getByRole("dialog").getByRole("button", { name: "Játék megszakítása", exact: true }).click();
    for (const page of pages) {
      await expect(leave(page)).toBeEnabled({ timeout: 5_000 });
      await expect(players(page).getByRole("listitem")).toHaveCount(3);
    }
    await leave(first).click();
    await joinScreen(first);
    await reset(second).click();
    await dialog(second).getByRole("button", { name: "Új lobby létrehozása", exact: true }).click();
    for (const page of pages) await joinScreen(page);

    await join(first, "Dorka");
    await join(second, "Erik");
    const countBefore = (await harness.db.query("select * from public.games")).rows.length;
    for (const page of [first, second]) await reset(page).click();
    let requests = 0;
    let release!: () => void;
    const bothRequests = new Promise<void>((resolve) => { release = resolve; });
    for (const page of [first, second]) await page.route("**/rest/v1/rpc/reset_lobby", async (route) => {
      if (++requests === 2) release();
      await bothRequests;
      await route.fallback();
    });
    await Promise.all([first, second].map((page) => dialog(page).getByRole("button", { name: "Új lobby létrehozása", exact: true }).click()));
    for (const page of pages) await joinScreen(page);
    expect((await harness.db.query("select * from public.games")).rows).toHaveLength(countBefore + 1);
    const finalLobby = (await harness.state()).game.id;
    await join(first, "Utolsó");
    await leave(first).click();
    await joinScreen(first);
    expect((await harness.state()).player_count).toBe(0);
    await join(third, "Új játékos");
    expect((await harness.state(harness.users[2])).game.id).toBe(finalLobby);
    expect((await harness.state(harness.users[2])).player_count).toBe(1);
    expect(await Promise.all(pages.map(identity))).toEqual(identities);
    expect(signUps).toEqual([1, 1, 1]);
    expect(logouts).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await harness.db.close();
  }
});

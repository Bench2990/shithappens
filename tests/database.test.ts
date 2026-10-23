import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GameState } from "../lib/game/types";
import type { Database } from "../lib/supabase/database.types";
import events from "../data/events.hu.json" with { type: "json" };

// Valódi PostgreSQL 17 / PLpgSQL WASM-ban. Csak a Supabase Auth környezetét
// helyettesítjük; a játékhoz a kiadott migrációt változtatás nélkül töltjük be.
let db: PGlite;
const users = Array.from({ length: 8 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
type Functions = Database["public"]["Functions"];
const authSchema = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
`;

async function rpc<T = unknown>(actor: number, name: keyof Functions, args: Record<string, unknown> = {}, database = db): Promise<T> {
  return database.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [users[actor]]);
    const entries = Object.entries(args);
    const result = await tx.query<{ result: T }>(
      `select public.${name}(${entries.map(([key], i) => `${key} => $${i + 1}`).join(", ")}) as result`,
      entries.map(([, value]) => value),
    );
    return result.rows[0].result;
  });
}

const state = (actor = 0) => rpc<GameState>(actor, "get_game_state");
const actorFor = (s: GameState, id: string) => s.players.findIndex((p) => p.id === id);

async function history(gameId: string, database = db) {
  return Promise.all(["players", "player_cards", "rounds", "ratings"].map(async (table) => (
    await database.query(`select * from public.${table} t where game_id = $1 order by to_jsonb(t)::text`, [gameId])
  ).rows));
}

async function join(count = 2) {
  const gameId = (await state()).game.id;
  for (let i = 0; i < count; i++) await rpc(i, "join_game", { p_game_id: gameId, p_nickname: `Játékos ${i + 1}` });
  return gameId;
}

async function boot(count = 2, scores = [50, 50, 50]) {
  const gameId = await join(count);
  await rpc(0, "start_game", { p_game_id: gameId });
  for (let i = 0; i < count; i++) {
    for (const score of scores) {
      const current = await state(i);
      await rpc(i, "rate_initial_card", { p_game_id: gameId, p_card_id: current.initial_card!.id, p_score: score });
    }
  }
  return state();
}

async function votes(s: GameState, values?: number[]) {
  let index = 0;
  for (let i = 0; i < s.players.length; i++) {
    if (s.players[i].id !== s.current_round!.active_player_id) {
      await rpc(i, "rate_round", { p_game_id: s.game.id, p_round_id: s.current_round!.id, p_score: values?.[index++] ?? 50 });
    }
  }
}

async function finish(s: GameState, position = 0, values?: number[]) {
  const active = actorFor(s, s.current_round!.active_player_id);
  await rpc(active, "select_placement", { p_game_id: s.game.id, p_round_id: s.current_round!.id, p_position: position });
  await votes(s, values);
  await rpc(active, "finalize_placement", { p_game_id: s.game.id, p_round_id: s.current_round!.id });
  return state();
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(authSchema);
  const migrations = new URL("../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(file, migrations), "utf8"));
  }
  await db.query("insert into auth.users (id) select unnest($1::uuid[])", [users]);
  await db.query(`insert into public.events (title, description, active)
    select title, description, active from jsonb_to_recordset($1::jsonb) as e(title text, description text, active boolean)`, [JSON.stringify(events)]);
});

beforeEach(async () => {
  await db.exec(`
    truncate public.room_state, public.ratings, public.player_cards, public.rounds, public.players, public.games;
    with game as (insert into public.games default values returning id)
    insert into public.room_state (current_game_id) select id from game;
    update public.events set active = true;
  `);
});

afterAll(async () => { await db?.close(); });

describe("Pontos PostgreSQL-játéklogika", () => {
  it.each([
    [[72, 60, 75, 65, 65], 674],
    [[1, 1, 1, 2], 13],
    [[99, 100, 100], 997],
    [[1], 10],
    [[100, 100], 1000],
  ])("egész tizedpontokra kerekíti az átlagot: %j", async (values, expected) => {
    const result = await db.query<{ score: number }>("select private.average_tenths($1::integer[]) as score", [values]);
    expect(result.rows[0].score).toBe(expected);
  });

  it.each([[[]], [[0]], [[101]], [[50, null]]])("elutasítja az érvénytelen pontszámlistát: %j", async (values) => {
    await expect(db.query("select private.average_tenths($1::integer[])", [values])).rejects.toThrow("Érvénytelen");
  });

  it.each([
    [[120, 480, 830], 674, 2, true],
    [[120, 480, 830], 674, 1, false],
    [[120, 480, 830], 10, 0, true],
    [[120, 480, 830], 1000, 3, true],
    [[120, 480, 480, 830], 480, 1, true],
    [[120, 480, 480, 830], 480, 2, true],
    [[120, 480, 480, 830], 480, 3, true],
    [[120, 480, 480, 830], 480, 0, false],
    [[480, 480], 480, 0, true],
    [[480, 480], 480, 2, true],
    [[120, 830], 500, -1, false],
    [[120, 830], 500, 3, false],
  ])("szomszédokkal és egyenlőséggel ellenőriz: %j / %i / %i", async (cards, score, position, expected) => {
    const result = await db.query<{ correct: boolean }>("select private.placement_correct($1::integer[], $2::integer, $3::integer) as correct", [cards, score, position]);
    expect(result.rows[0].correct).toBe(expected);
  });
});

describe("Lobby és kezdőkártyák", () => {
  it("a kész SQL-mintaadatfájl futtatható és ismételhető, az eseményazonosítók megmaradnak", async () => {
    const before = await db.query<{ id: string }>("select id from public.events order by id");
    const seed = await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8");
    await db.exec(seed);
    await db.exec(seed);
    const after = await db.query<{ id: string }>("select id from public.events order by id");
    expect(after.rows).toEqual(before.rows);
    expect(after.rows).toHaveLength(60);
  });

  it("sorrendben, egyszer csatlakoztat; a nevek nem foglalhatók kétszer", async () => {
    const id = await join();
    await rpc(0, "join_game", { p_game_id: id, p_nickname: "Más név" });
    expect((await state()).players.map((p) => p.join_order)).toEqual([1, 2]);
    await expect(rpc(2, "join_game", { p_game_id: id, p_nickname: "játékos 1" })).rejects.toThrow("már használja");
    await expect(rpc(2, "join_game", { p_game_id: id, p_nickname: " " })).rejects.toThrow("2–24");
  });

  it("két résztvevő és elegendő aktív esemény nélkül nem indít", async () => {
    const id = await join(1);
    await expect(rpc(0, "start_game", { p_game_id: id })).rejects.toThrow("két játékos");
    await rpc(1, "join_game", { p_game_id: id, p_nickname: "Második" });
    await db.exec("update public.events set active = false where id not in (select id from public.events limit 18)");
    await expect(rpc(0, "start_game", { p_game_id: id })).rejects.toThrow("19 szükséges");
    expect((await state()).game.status).toBe("lobby");
    expect((await db.query("select * from public.player_cards")).rows).toHaveLength(0);
  });

  it("ismételt indításkor is pontosan 18 különböző lapot oszt hat főre", async () => {
    const id = await join(6);
    await Promise.all([0, 1, 2].map((i) => rpc(i, "start_game", { p_game_id: id })));
    const s = await state();
    const cards = await db.query<{ event_id: string }>("select event_id from public.player_cards");
    expect(cards.rows).toHaveLength(18);
    expect(new Set(cards.rows.map((c) => c.event_id)).size).toBe(18);
    expect(s.players.some((p) => p.id === s.game.starting_player_id)).toBe(true);
    expect(s.current_round).toBeNull();
    await expect(rpc(6, "join_game", { p_game_id: id, p_nickname: "Elkésett" })).rejects.toThrow("már elindult");
  });

  it("csak a következő saját lap pontozható, az eredmény megváltoztathatatlan", async () => {
    const id = await join();
    await rpc(0, "start_game", { p_game_id: id });
    const s = await state();
    const future = (await db.query<{ id: string }>("select id from public.player_cards where player_id = $1 and initial_order = 2", [s.me_id])).rows[0];
    await expect(rpc(0, "rate_initial_card", { p_game_id: id, p_card_id: future.id, p_score: 50 })).rejects.toThrow("Előbb");
    await expect(rpc(1, "rate_initial_card", { p_game_id: id, p_card_id: s.initial_card!.id, p_score: 50 })).rejects.toThrow("saját");
    const args = { p_game_id: id, p_card_id: s.initial_card!.id, p_score: 76 };
    await rpc(0, "rate_initial_card", args);
    await rpc(0, "rate_initial_card", args);
    await expect(rpc(0, "rate_initial_card", { ...args, p_score: 77 })).rejects.toThrow("véglegesítetted");
    expect((await state()).my_cards[0].score_tenths).toBe(760);
    expect((await state()).initial_card!.order).toBe(2);
  });

  it("az utolsó kezdőértékelés automatikusan elindítja a kisorsolt játékos körét", async () => {
    const id = await join();
    await rpc(0, "start_game", { p_game_id: id });
    for (let actor = 0; actor < 2; actor++) {
      for (let slot = 0; slot < 3; slot++) {
        const s = await state(actor);
        if (actor === 1 && slot === 0) {
          const waiting = await state(0);
          expect(waiting.initial_card).toBeNull();
          expect(waiting.my_cards).toHaveLength(3);
          expect(waiting.game.status).toBe("initial_rating");
        }
        await rpc(actor, "rate_initial_card", { p_game_id: id, p_card_id: s.initial_card!.id, p_score: 50 });
      }
    }
    const s = await state();
    expect(s.game.status).toBe("playing");
    expect(s.current_round!.active_player_id).toBe(s.game.starting_player_id);
    expect(s.current_round!.number).toBe(1);
  });
});

describe("Titkosság és jogosultságok", () => {
  it("a nyitott kör sem más pontszámait, sem az elkészült átlagot nem adja vissza", async () => {
    const s = await boot(6);
    await votes(s, [72, 60, 75, 65, 65]);
    const active = actorFor(s, s.current_round!.active_player_id);
    const snapshot = await state(active);
    expect(snapshot.current_round!.ratings_count).toBe(5);
    expect(snapshot.current_round!.my_rating).toBeNull();
    expect(snapshot.current_round).not.toHaveProperty("average_tenths");
    expect(snapshot.current_round).not.toHaveProperty("ratings");
    expect(snapshot.latest_result).toBeNull();
    const stored = await db.query<{ average_tenths: number }>("select average_tenths from public.rounds where id = $1", [s.current_round!.id]);
    expect(stored.rows[0].average_tenths).toBe(674);
  });

  it("a nyers táblák, a privát segédek és az azonosítás nélküli RPC elérhetetlenek", async () => {
    for (const table of ["events", "games", "players", "player_cards", "rounds", "ratings"]) {
      await expect(db.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await tx.query(`select * from public.${table}`);
      })).rejects.toMatchObject({ code: "42501" });
    }
    await expect(db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.exec("update public.room_state set revision = 100");
    })).rejects.toMatchObject({ code: "42501" });
    await expect(db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.exec("select private.average_tenths(array[50])");
    })).rejects.toMatchObject({ code: "42501" });
    await expect(db.transaction(async (tx) => {
      await tx.exec("set local role anon");
      await tx.exec("select public.get_game_state()");
    })).rejects.toMatchObject({ code: "42501" });
    const policies = await db.query<{ count: number }>("select count(*)::integer as count from pg_policies where schemaname = 'public'");
    expect(policies.rows[0].count).toBe(1); // Csak a titokmentes változásjelző olvasható.
  });

  it("kívülállónak nem mutatja a folyamatban lévő parti lapjait és neveit", async () => {
    const s = await boot();
    const outsider = await state(7);
    expect(outsider.me_id).toBeNull();
    expect(outsider.players).toEqual([]);
    expect(outsider.my_cards).toEqual([]);
    expect(outsider.current_round).toBeNull();
    await expect(rpc(7, "rate_round", { p_game_id: s.game.id, p_round_id: s.current_round!.id, p_score: 50 })).rejects.toThrow("Nem vagy");
  });

  it("ellenőrzi az aktív szerepet, a tartományokat és a pontozás befejezését", async () => {
    const s = await boot();
    const active = actorFor(s, s.current_round!.active_player_id);
    const other = 1 - active;
    const args = { p_game_id: s.game.id, p_round_id: s.current_round!.id };
    await expect(rpc(active, "rate_round", { ...args, p_score: 50 })).rejects.toThrow("saját körödben");
    await expect(rpc(other, "rate_round", { ...args, p_score: 101 })).rejects.toThrow("1 és 100");
    await expect(rpc(other, "select_placement", { ...args, p_position: 0 })).rejects.toThrow("soron lévő");
    await expect(rpc(other, "finalize_placement", args)).rejects.toThrow("soron lévő");
    await expect(rpc(active, "select_placement", { ...args, p_position: 4 })).rejects.toThrow("Érvénytelen");
    await expect(rpc(active, "finalize_placement", args)).rejects.toThrow("összes");
    await votes(s);
    await expect(rpc(active, "finalize_placement", args)).rejects.toThrow("válaszd ki");
  });
});

describe("Teljes körök és újracsatlakozás", () => {
  it("csak egyszer rögzíti a pontozást és a megszerzett lapot; a lezárás felfedi a véleményeket", async () => {
    const s = await boot(6, [12, 48, 83]);
    const active = actorFor(s, s.current_round!.active_player_id);
    const voter = (active + 1) % 6;
    const args = { p_game_id: s.game.id, p_round_id: s.current_round!.id };
    const score = { ...args, p_score: 72 };
    await rpc(voter, "rate_round", score);
    await rpc(voter, "rate_round", score);
    await expect(rpc(voter, "rate_round", { ...score, p_score: 71 })).rejects.toThrow("véglegesítetted");
    for (let i = 0; i < 6; i++) if (i !== active && i !== voter) await rpc(i, "rate_round", { ...args, p_score: 65 });
    await rpc(active, "select_placement", { ...args, p_position: 2 });
    const reconnected = await state(active);
    expect(reconnected.current_round!.selected_position).toBe(2);
    await rpc(active, "finalize_placement", args);
    await rpc(active, "finalize_placement", args);
    await rpc(voter, "rate_round", score); // Későn megérkezett ismételt kérés.
    const after = await state(active);
    expect(after.my_cards).toHaveLength(4);
    expect(after.game.round_number).toBe(2);
    expect(after.latest_result!.correct).toBe(true);
    expect(after.latest_result!.ratings).toHaveLength(5);
    expect(after.latest_result!.average_tenths).toBe(664);
    expect(after.latest_result!.lower_tenths).toBe(480);
    expect(after.latest_result!.upper_tenths).toBe(830);
    expect(after.latest_result!.card_count_after).toBe(4);
    expect(after.my_cards.map((c) => c.score_tenths)).toEqual([120, 480, 664, 830]);
    expect((await state(voter)).latest_result).toEqual(after.latest_result);
  });

  it("hibás lapot visszaenged, újrahúzásnál új értékelést kér és nem használ régi átlagot", async () => {
    const s = await boot(2, [20, 50, 80]);
    const event = s.current_round!.event.id;
    await db.query("update public.events set active = (id = $1)", [event]);
    const after = await finish(s, 0, [65]);
    expect(after.latest_result!.correct).toBe(false);
    expect(after.latest_result!.card_count_after).toBe(3);
    expect(after.current_round!.event.id).toBe(event);
    expect(after.current_round!.ratings_count).toBe(0);
    expect(after.current_round!.my_rating).toBeNull();
    const stored = await db.query<{ average_tenths: number | null }>("select average_tenths from public.rounds where id = $1", [after.current_round!.id]);
    expect(stored.rows[0].average_tenths).toBeNull();
    const next = await finish(after, 1, [30]);
    expect(next.latest_result!.average_tenths).toBe(300);
    expect(next.latest_result!.correct).toBe(true);
    expect(next.game.end_reason).toBe("exhausted");
  });

  it("a véletlen kezdőtől a csatlakozási sorrendben lép és körbeér", async () => {
    let s = await boot(3);
    const startingIndex = actorFor(s, s.game.starting_player_id!);
    for (let i = 0; i < 5; i++) {
      expect(actorFor(s, s.current_round!.active_player_id)).toBe((startingIndex + i) % 3);
      s = await finish(s);
      const open = await db.query<{ count: number }>("select count(*)::integer as count from public.rounds where status = 'open'");
      expect(open.rows[0].count).toBe(1);
    }
  });

  it("a hatfős teljes játék a 10. lapnál lezárul, további kör nélkül", async () => {
    let s = await boot(6);
    const starting = s.game.starting_player_id;
    let rounds = 0;
    while (s.game.status === "playing" && rounds < 50) {
      s = await finish(s);
      rounds++;
    }
    expect(rounds).toBe(37);
    expect(s.game.status).toBe("finished");
    expect(s.game.end_reason).toBe("winner");
    expect(s.game.winner_id).toBe(starting);
    expect(s.players.find((p) => p.id === starting)!.card_count).toBe(10);
    expect(s.players.reduce((sum, p) => sum + p.card_count, 0)).toBe(55);
    expect(s.current_round).toBeNull();
    expect(s.latest_result!.card_count_after).toBe(10);
    expect((await db.query("select * from public.rounds where status = 'open'")).rows).toHaveLength(0);
    const reloaded = await state(actorFor(s, starting!));
    expect(reloaded.my_cards).toHaveLength(10);
  });

  it("adminisztrátori deaktiválás miatti paklielfogyáskor szabályosan lezár", async () => {
    const s = await boot();
    await db.exec("update public.events set active = false");
    const after = await finish(s);
    expect(after.game.status).toBe("finished");
    expect(after.game.end_reason).toBe("exhausted");
    expect(after.game.winner_id).toBeNull();
    expect(after.current_round).toBeNull();
    expect(after.latest_result!.correct).toBe(true);
  });

  it("az ismételt újraindítás nem nullázza az új lobbit, a régi játék megmarad", async () => {
    const s = await boot();
    await db.exec("update public.events set active = false");
    const ended = await finish(s);
    const args = { p_game_id: ended.game.id };
    const [first, repeated] = await Promise.all([rpc<string>(0, "restart_game", args), rpc<string>(1, "restart_game", args)]);
    expect(first).toBe(repeated);
    const next = await state();
    expect(next.game.id).not.toBe(s.game.id);
    expect(next.game.status).toBe("lobby");
    expect(next.my_cards).toEqual([]);
    expect(next.player_count).toBe(1);
    expect((await state(1)).me_id).toBeNull();
    await rpc(1, "join_game", { p_game_id: next.game.id, p_nickname: "Játékos 2" });
    await rpc(0, "restart_game", args);
    expect((await state()).player_count).toBe(2);
    await expect(rpc(0, "start_game", { p_game_id: s.game.id })).rejects.toThrow("másik parti");
    const history = await db.query<{ count: number }>("select count(*)::integer as count from public.rounds where game_id = $1", [s.game.id]);
    expect(history.rows[0].count).toBe(1);
    expect((await db.query("select * from public.events")).rows).toHaveLength(events.length);
  });
});

describe("Parti megszakítása", () => {
  it("mindenkit a közös lobbyba visz megőrzött nevekkel, az előzmények törlése nélkül", async () => {
    const s = await finish(await boot(3));
    const active = actorFor(s, s.current_round!.active_player_id);
    const voter = (active + 1) % 3;
    await rpc(active, "select_placement", { p_game_id: s.game.id, p_round_id: s.current_round!.id, p_position: 1 });
    await rpc(voter, "rate_round", { p_game_id: s.game.id, p_round_id: s.current_round!.id, p_score: 65 });
    const before = await history(s.game.id);
    const revision = (await state()).revision;
    const nextId = await rpc<string>(voter, "cancel_game", { p_game_id: s.game.id });

    for (let actor = 0; actor < 3; actor++) {
      const next = await state(actor);
      expect(next.game).toEqual({
        id: nextId, status: "lobby", starting_player_id: null, current_player_id: null,
        winner_id: null, end_reason: null, round_number: 0,
      });
      expect(nextId).not.toBe(s.game.id);
      expect(next.revision).toBe(revision + 1);
      expect(next.player_count).toBe(3);
      expect(next.players.map((p) => [p.nickname, p.join_order, p.card_count, p.initial_rated]))
        .toEqual(s.players.map((p) => [p.nickname, p.join_order, 0, 0]));
      expect(next.me_id).toBe(next.players[actor].id);
      expect(next.me_id).not.toBe(s.players[actor].id);
      expect(next.my_cards).toEqual([]);
      expect(next.initial_card).toBeNull();
      expect(next.current_round).toBeNull();
      expect(next.latest_result).toBeNull();
      expect(next.cancellation).toEqual({ game_id: s.game.id, nickname: s.players[voter].nickname, cancelled_at: expect.any(String) });
    }
    const archived = (await db.query<Record<string, unknown>>("select status, end_reason, current_player_id, winner_id, cancelled_by_player_id, finished_at from public.games where id = $1", [s.game.id])).rows[0];
    expect(archived).toMatchObject({ status: "finished", end_reason: "cancelled", current_player_id: null, winner_id: null, cancelled_by_player_id: s.players[voter].id });
    expect(archived.finished_at).not.toBeNull();
    expect(await history(s.game.id)).toEqual(before);
    expect((await state(7)).cancellation).toBeNull();
    expect((await db.query("select * from public.events")).rows).toHaveLength(events.length);
    expect(Object.keys((await db.query<Record<string, unknown>>("select * from public.room_state")).rows[0]).sort())
      .toEqual(["current_game_id", "id", "revision", "updated_at"]);
  });

  it("a kezdőpontozás és a kész játékosok várakozása közben is megszakítható", async () => {
    const gameId = await join();
    await rpc(0, "start_game", { p_game_id: gameId });
    for (let slot = 0; slot < 3; slot++) {
      const s = await state();
      await rpc(0, "rate_initial_card", { p_game_id: gameId, p_card_id: s.initial_card!.id, p_score: 40 + slot });
    }
    const rating = await state(1);
    await rpc(1, "rate_initial_card", { p_game_id: gameId, p_card_id: rating.initial_card!.id, p_score: 65 });
    expect((await state()).initial_card).toBeNull();
    expect((await state(1)).initial_card!.order).toBe(2);
    const before = await history(gameId);
    await rpc(0, "cancel_game", { p_game_id: gameId });
    expect((await state()).game.status).toBe("lobby");
    expect((await state(1)).game.status).toBe("lobby");
    expect(await history(gameId)).toEqual(before);
  });

  it.each(["active", "voter"])("bármely résztvevő megszakíthat: %s", async (role) => {
    const s = await boot();
    const active = actorFor(s, s.current_round!.active_player_id);
    const actor = role === "active" ? active : 1 - active;
    await rpc(actor, "cancel_game", { p_game_id: s.game.id });
    expect((await state()).cancellation!.nickname).toBe(s.players[actor].nickname);
  });

  it("azonosítás és tagság nélkül, lobbyban és lezárt partinál nem enged megszakítani", async () => {
    const gameId = await join();
    await expect(rpc(0, "cancel_game", { p_game_id: gameId })).rejects.toThrow("folyamatban lévő");
    await rpc(0, "start_game", { p_game_id: gameId });
    await expect(rpc(7, "cancel_game", { p_game_id: gameId })).rejects.toThrow("résztvevője");
    await expect(db.transaction(async (tx) => {
      await tx.exec("set local role anon");
      await tx.query("select public.cancel_game($1)", [gameId]);
    })).rejects.toMatchObject({ code: "42501" });
    await expect(db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.query("select public.cancel_game($1)", [gameId]);
    })).rejects.toThrow("Azonosítás szükséges");
    await db.query("update public.games set status = 'finished', end_reason = 'exhausted', finished_at = now(), current_player_id = null where id = $1", [gameId]);
    await expect(rpc(0, "cancel_game", { p_game_id: gameId })).rejects.toThrow("folyamatban lévő");
    expect((await db.query("select * from public.games")).rows).toHaveLength(1);
  });

  it("két párhuzamos megszakítás egy lobbyt nyit, az ismétlés nem nullázza az új partit", async () => {
    const s = await boot();
    const args = { p_game_id: s.game.id };
    const [first, second] = await Promise.all([rpc<string>(0, "cancel_game", args), rpc<string>(1, "cancel_game", args)]);
    expect(first).toBe(second);
    const lobby = await state();
    expect(lobby.revision).toBe(s.revision + 1);
    expect((await db.query("select * from public.games")).rows).toHaveLength(2);
    const notice = lobby.cancellation;
    await rpc(1, "cancel_game", args);
    expect((await state()).cancellation).toEqual(notice);
    await expect(rpc(7, "cancel_game", args)).rejects.toThrow("résztvevője");
    await rpc(1, "start_game", { p_game_id: first });
    const fresh = await state();
    expect(fresh.game.status).toBe("initial_rating");
    expect(fresh.cancellation).toBeNull();
    expect(fresh.initial_card!.order).toBe(1);
    expect(fresh.my_cards).toEqual([]);
    expect(fresh.players.every((p) => p.card_count === 3 && p.initial_rated === 0)).toBe(true);
    expect((await db.query("select * from public.player_cards where game_id = $1 and score_tenths is null", [first])).rows).toHaveLength(6);
    await rpc(0, "cancel_game", args);
    expect(await state()).toEqual(fresh);
    expect((await db.query("select * from public.games")).rows).toHaveLength(2);
  });

  it("a régi lap-, kör-, indítási és megszakítási kérések nem módosíthatják az új partit", async () => {
    const old = await boot();
    const active = actorFor(old, old.current_round!.active_player_id);
    const voter = 1 - active;
    const oldCard = (await db.query<{ id: string }>("select id from public.player_cards where player_id = $1 order by initial_order limit 1", [old.players[0].id])).rows[0].id;
    const archived = await history(old.game.id);
    const nextId = await rpc<string>(0, "cancel_game", { p_game_id: old.game.id });
    await rpc(1, "start_game", { p_game_id: nextId });
    for (let actor = 0; actor < 2; actor++) {
      for (let slot = 0; slot < 3; slot++) {
        const s = await state(actor);
        await rpc(actor, "rate_initial_card", { p_game_id: nextId, p_card_id: s.initial_card!.id, p_score: 25 });
      }
    }
    const fresh = await state();
    expect(fresh.game.round_number).toBe(1);
    expect(fresh.latest_result).toBeNull();
    expect(fresh.current_round!.ratings_count).toBe(0);
    expect(fresh.current_round!.selected_position).toBeNull();
    expect(fresh.my_cards.map((c) => c.score_tenths)).toEqual([250, 250, 250]);
    for (const gameId of [old.game.id, nextId]) {
      const args = { p_game_id: gameId, p_round_id: old.current_round!.id };
      await expect(rpc(0, "rate_initial_card", { p_game_id: gameId, p_card_id: oldCard, p_score: 90 })).rejects.toThrow();
      await expect(rpc(voter, "rate_round", { ...args, p_score: 90 })).rejects.toThrow();
      await expect(rpc(active, "select_placement", { ...args, p_position: 0 })).rejects.toThrow();
      await expect(rpc(active, "finalize_placement", args)).rejects.toThrow();
    }
    await expect(rpc(0, "start_game", { p_game_id: old.game.id })).rejects.toThrow("másik parti");
    await rpc(0, "restart_game", { p_game_id: old.game.id });
    await rpc(1, "cancel_game", { p_game_id: old.game.id });
    expect(await state()).toEqual(fresh);
    expect(await history(old.game.id)).toEqual(archived);
  });

  it("hiba esetén az archiválás, az új lobby és a teljes névsor együtt visszagördül", async () => {
    const s = await boot();
    const before = await history(s.game.id);
    await db.exec(`
      create function private.reject_test_lobby_switch() returns trigger language plpgsql as $$
      begin
        if new.current_game_id <> old.current_game_id then raise exception 'Teszt: sikertelen lobbyváltás'; end if;
        return new;
      end;
      $$;
      create trigger reject_test_lobby_switch before update on public.room_state
        for each row execute function private.reject_test_lobby_switch();
    `);
    try {
      await expect(rpc(0, "cancel_game", { p_game_id: s.game.id })).rejects.toThrow("sikertelen lobbyváltás");
      expect(await state()).toEqual(s);
      expect(await history(s.game.id)).toEqual(before);
      expect((await db.query("select * from public.games")).rows).toHaveLength(1);
    } finally {
      await db.exec("drop trigger reject_test_lobby_switch on public.room_state; drop function private.reject_test_lobby_switch()");
    }
  });

  it("az új migráció meglévő, pontozott és lezárt adatokat is veszteség nélkül frissít", async () => {
    const legacy = new PGlite();
    try {
      await legacy.exec(authSchema);
      await legacy.exec(await readFile(new URL("../supabase/migrations/202610200001_game.sql", import.meta.url), "utf8"));
      await legacy.query("insert into auth.users (id) select unnest($1::uuid[])", [users]);
      await legacy.query(`insert into public.events (title, description, active)
        select title, description, active from jsonb_to_recordset($1::jsonb) as e(title text, description text, active boolean)`, [JSON.stringify(events)]);
      const gameId = (await rpc<GameState>(0, "get_game_state", {}, legacy)).game.id;
      for (let actor = 0; actor < 2; actor++) {
        await rpc(actor, "join_game", { p_game_id: gameId, p_nickname: `Régi játékos ${actor + 1}` }, legacy);
      }
      await rpc(0, "start_game", { p_game_id: gameId }, legacy);
      const initial = await rpc<GameState>(0, "get_game_state", {}, legacy);
      await rpc(0, "rate_initial_card", { p_game_id: gameId, p_card_id: initial.initial_card!.id, p_score: 73 }, legacy);
      await legacy.exec(`
        insert into public.games (status, end_reason, finished_at) values ('finished', 'exhausted', now());
        with game as (insert into public.games default values returning id),
        player as (
          insert into public.players (game_id, user_id, nickname, join_order)
          select id, '${users[0]}', 'Régi győztes', 1 from game returning id, game_id
        )
        select 1 from player;
        update public.games g set status = 'finished', end_reason = 'winner', finished_at = now(), winner_id = p.id
          from public.players p where p.game_id = g.id and p.nickname = 'Régi győztes';
      `);
      const before = await history(gameId, legacy);
      const snapshot = await rpc<GameState>(0, "get_game_state", {}, legacy);
      const gamesBefore = (await legacy.query("select to_jsonb(g) as data from public.games g order by id")).rows;
      await legacy.exec(await readFile(new URL("../supabase/migrations/202610230001_cancel_game.sql", import.meta.url), "utf8"));
      expect(await history(gameId, legacy)).toEqual(before);
      expect(await rpc<GameState>(0, "get_game_state", {}, legacy)).toEqual({ ...snapshot, cancellation: null });
      expect((await legacy.query("select to_jsonb(g) - 'cancelled_by_player_id' - 'cancelled_from_game_id' as data from public.games g order by id")).rows).toEqual(gamesBefore);
      await rpc(1, "cancel_game", { p_game_id: gameId }, legacy);
      expect((await rpc<GameState>(0, "get_game_state", {}, legacy)).game.status).toBe("lobby");
      expect(await history(gameId, legacy)).toEqual(before);
    } finally {
      await legacy.close();
    }
  });
});

/**
 * Valódi, párhuzamos HTTP-kérések és Realtime hat névtelen résztvevővel.
 * Csak külön TESZTPROJEKTEN futtasd: lejátszik egy partit a közös szobában!
 * Nem használ service role kulcsot. A használt projektben üres lobby szükséges.
 */
import assert from "node:assert/strict";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types";
import type { GameState } from "../lib/game/types";

if (process.env.ALLOW_LIVE_GAME_TEST !== "1") {
  throw new Error("Ez a teszt valódi partit játszik. Külön tesztprojekten állítsd be: ALLOW_LIVE_GAME_TEST=1");
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error("Hiányzik a Supabase URL vagy a publikus kulcs.");

const clients: SupabaseClient<Database>[] = [];
const channels: RealtimeChannel[] = [];
const notifications = Array.from({ length: 6 }, () => 0);
const gameIds: string[] = [];
let realtimeFailure: Error | undefined;

async function getState(client: SupabaseClient<Database>): Promise<GameState> {
  const { data, error } = await client.rpc("get_game_state");
  if (error) throw error;
  return data as unknown as GameState;
}

function check(result: { error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
}

async function until(predicate: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 20_000;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error(`Időtúllépés: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

try {
  for (let i = 0; i < 6; i++) {
    const client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: true } });
    clients.push(client);
    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw error;
    assert(data.session);
    await client.realtime.setAuth(data.session.access_token);
    if (i === 0) {
      const initial = await getState(client);
      assert.equal(initial.game.status, "lobby", "Külön, üres lobby szükséges; a teszt nem töröl idegen partit.");
      assert.equal(initial.player_count, 0, "A teszt nem csatlakozik meglévő játékosok mellé.");
      assert(initial.events_available >= 55, "Importálj legalább 55 aktív eseményt.");
      gameIds.push(initial.game.id);
    }
    const channel = client.channel(`smoke-${i}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "room_state" }, (payload) => {
        try { assert.deepEqual(Object.keys(payload.new).sort(), ["current_game_id", "id", "revision", "updated_at"]); }
        catch (error) { realtimeFailure = error as Error; }
        notifications[i]++;
      });
    channels.push(channel);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("A Realtime feliratkozás nem sikerült.")), 20_000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timer); reject(new Error(status)); }
      });
    });
    check(await client.rpc("join_game", { p_game_id: gameIds[0], p_nickname: `Teszt ${i + 1}` }));
  }
  await until(async () => (await getState(clients[0])).player_count === 6, "hatfős lobby");
  await until(() => notifications.every((count) => count > 0), "Realtime minden résztvevőnek");
  const gameId = gameIds[0];
  const starting = await Promise.all(clients.slice(0, 3).map((client) => client.rpc("start_game", { p_game_id: gameId })));
  starting.forEach(check);
  for (let card = 0; card < 3; card++) {
    await Promise.all(clients.map(async (client) => {
      const s = await getState(client);
      assert(s.initial_card);
      check(await client.rpc("rate_initial_card", { p_game_id: gameId, p_card_id: s.initial_card.id, p_score: 50 }));
    }));
  }
  let s = await getState(clients[0]);
  let rounds = 0;
  while (s.game.status === "playing" && rounds < 50) {
    const round = s.current_round!;
    const activeIndex = s.players.findIndex((p) => p.id === round.active_player_id);
    const args = { p_game_id: gameId, p_round_id: round.id };
    check(await clients[activeIndex].rpc("select_placement", { ...args, p_position: 0 }));
    const votes = clients.flatMap((client, index) => index === activeIndex ? []
      : [client.rpc("rate_round", { ...args, p_score: 50 }), client.rpc("rate_round", { ...args, p_score: 50 })]);
    (await Promise.all(votes)).forEach(check);
    const hidden = await getState(clients[activeIndex]);
    assert(!("average_tenths" in hidden.current_round!));
    assert(!("ratings" in hidden.current_round!));
    assert.equal(hidden.current_round!.ratings_count, 5);
    const raw = await clients[activeIndex].schema("public").from("room_state").select("*");
    check(raw);
    const { data: auth } = await clients[activeIndex].auth.getSession();
    const forbidden = await fetch(`${url}/rest/v1/ratings?select=*`, {
      headers: { apikey: key, Authorization: `Bearer ${auth.session!.access_token}` },
    });
    assert([401, 403].includes(forbidden.status), "A nyers értékelések nem lehetnek olvashatók.");
    (await Promise.all([0, 1].map(() => clients[activeIndex].rpc("finalize_placement", args)))).forEach(check);
    s = await getState(clients[0]);
    assert.equal(s.latest_result!.average_tenths, 500);
    assert.equal(s.latest_result!.ratings.length, 5);
    assert.equal(s.latest_result!.correct, true);
    rounds++;
  }
  assert.equal(s.game.status, "finished");
  assert.equal(rounds, 37);
  assert.equal(s.current_round, null);
  assert.equal(s.players.find((p) => p.id === s.game.winner_id)!.card_count, 10);
  assert.equal(realtimeFailure, undefined);
  // Ugyanazzal a tokennel létrehozott új kliens: böngésző-újranyitás modellje.
  const { data } = await clients[0].auth.getSession();
  assert(data.session);
  const returning = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  check(await returning.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token }));
  assert.deepEqual((await getState(returning)).my_cards, (await getState(clients[0])).my_cards);
  await returning.auth.stopAutoRefresh();
  console.log(`Sikeres élő teszt: 6 játékos, ${rounds} kör, győzelem, titkosság, párhuzamos kérések és Realtime.`);
  console.log("A tesztparti befejezett állapotban maradt. Újabb futtatáshoz külön üres tesztszoba szükséges.");
} catch (error) {
  console.error("Sikertelen élő teszt:", error);
  process.exitCode = 1;
} finally {
  await Promise.all(clients.map(async (client, i) => {
    if (channels[i]) await client.removeChannel(channels[i]);
    await client.auth.stopAutoRefresh();
  }));
}

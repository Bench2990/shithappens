import { PGlite } from "@electric-sql/pglite";
import type { BrowserContext, WebSocketRoute } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { GameState } from "../../lib/game/types";
import events from "../../data/events.hu.json" with { type: "json" };

// Csak böngészőteszt: a Supabase hálózati/Auth rétegét helyettesíti.
// A teljes játékmotor és a jogosultságellenőrzés itt is az eredeti SQL.
type Message = { topic: string; event: string; payload: Record<string, unknown>; ref: string | null; join_ref?: string | null };
type Socket = { ws: WebSocketRoute; topic: string; joinRef: string | null; array: boolean; userId: string };
const allowed = new Set(["get_game_state", "join_game", "start_game", "rate_initial_card", "rate_round", "select_placement", "finalize_placement", "restart_game"]);

export class SupabaseBrowserHarness {
  db = new PGlite();
  sockets = new Set<Socket>();
  users: string[] = [];

  async initialize() {
    await this.db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
    `);
    await this.db.exec(await readFile("supabase/migrations/202610200001_game.sql", "utf8"));
    await this.db.query(`insert into public.events (title, description, active)
      select title, description, active from jsonb_to_recordset($1::jsonb) as e(title text, description text, active boolean)`, [JSON.stringify(events)]);
  }

  send(socket: Socket, message: Message) {
    socket.ws.send(JSON.stringify(socket.array
      ? [message.join_ref ?? socket.joinRef, message.ref, message.topic, message.event, message.payload]
      : message));
  }

  async notify() {
    const { rows } = await this.db.query<Record<string, unknown>>("select * from public.room_state where id = 1");
    for (const socket of this.sockets) this.send(socket, {
      topic: socket.topic, event: "postgres_changes", ref: null, join_ref: socket.joinRef,
      payload: { ids: [1], data: {
        schema: "public", table: "room_state", type: "UPDATE", commit_timestamp: new Date().toISOString(),
        columns: [
          { name: "id", type: "int4" }, { name: "current_game_id", type: "uuid" },
          { name: "revision", type: "int8" }, { name: "updated_at", type: "timestamptz" },
        ], record: rows[0], old_record: { id: 1 }, errors: null,
      } },
    });
  }

  disconnectChannels(userId: string) {
    for (const socket of this.sockets) if (socket.userId === userId) this.send(socket, {
      topic: socket.topic, event: "phx_close", ref: null, join_ref: socket.joinRef, payload: {},
    });
  }

  async rpc<T = unknown>(userId: string, name: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!allowed.has(name) || Object.keys(args).some((key) => !/^p_[a-z_]+$/.test(key))) throw new Error("Nem engedélyezett RPC");
    const result = await this.db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
      const keys = Object.keys(args);
      return tx.query<{ value: T }>(`select public.${name}(${keys.map((key, i) => `${key} => $${i + 1}`).join(", ")}) as value`, Object.values(args));
    });
    if (name !== "get_game_state") await this.notify();
    return result.rows[0].value;
  }

  async attach(context: BrowserContext): Promise<string> {
    const userId = randomUUID();
    this.users.push(userId);
    await this.db.query("insert into auth.users (id) values ($1)", [userId]);
    const user = {
      id: userId, aud: "authenticated", role: "authenticated", email: "", is_anonymous: true,
      app_metadata: { provider: "anonymous", providers: [] }, user_metadata: {}, identities: [],
      created_at: new Date().toISOString(),
    };
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: userId, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, is_anonymous: true })}.test-signature`;

    await context.route("https://szar-ugy-browser-test.supabase.co/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const headers = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
        "access-control-allow-methods": "GET, POST, OPTIONS",
      };
      if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
      if (url.pathname.startsWith("/auth/v1/")) {
        await route.fulfill({ headers, json: url.pathname.endsWith("/user") ? user : {
          access_token: token, refresh_token: randomUUID(), token_type: "bearer", expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600, user,
        } });
        return;
      }
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        try {
          const name = url.pathname.split("/").at(-1)!;
          const result = await this.rpc(userId, name, request.postDataJSON() ?? {});
          await route.fulfill({ headers, json: result ?? null });
        } catch (error) {
          await route.fulfill({ status: 400, headers, json: { code: "P0001", message: error instanceof Error ? error.message : String(error) } });
        }
        return;
      }
      await route.fulfill({ status: 403, headers, json: { message: "Nincs közvetlen táblaelérés." } });
    });

    await context.routeWebSocket(/wss:\/\/szar-ugy-browser-test\.supabase\.co\/.*/, (ws) => {
      const socket: Socket = { ws, topic: "", joinRef: null, array: false, userId };
      ws.onMessage((raw) => {
        const parsed = JSON.parse(String(raw));
        socket.array = Array.isArray(parsed);
        const message: Message = socket.array
          ? { join_ref: parsed[0], ref: parsed[1], topic: parsed[2], event: parsed[3], payload: parsed[4] }
          : parsed;
        if (message.event === "phx_join") {
          socket.topic = message.topic;
          socket.joinRef = message.join_ref ?? message.ref;
          this.sockets.add(socket);
          this.send(socket, { ...message, event: "phx_reply", payload: {
            status: "ok", response: { postgres_changes: [{ id: 1, event: "UPDATE", schema: "public", table: "room_state", filter: "id=eq.1" }] },
          } });
        } else if (message.event === "heartbeat" || message.event === "phx_leave") {
          this.send(socket, { ...message, event: "phx_reply", payload: { status: "ok", response: {} } });
          if (message.event === "phx_leave") this.sockets.delete(socket);
        }
      });
      ws.onClose(() => { this.sockets.delete(socket); });
    });
    return userId;
  }

  state(userId = this.users[0]) { return this.rpc<GameState>(userId, "get_game_state"); }

  async advanceRound() {
    const s = await this.state();
    const round = s.current_round!;
    const { rows } = await this.db.query<{ user_id: string; id: string }>("select id, user_id from public.players where game_id = $1 order by join_order", [s.game.id]);
    const active = rows.find((p) => p.id === round.active_player_id)!;
    const args = { p_game_id: s.game.id, p_round_id: round.id };
    await this.rpc(active.user_id, "select_placement", { ...args, p_position: 0 });
    for (const player of rows) if (player.id !== active.id) await this.rpc(player.user_id, "rate_round", { ...args, p_score: 50 });
    await this.rpc(active.user_id, "finalize_placement", args);
  }

  async finishGame() {
    while ((await this.state()).game.status === "playing") await this.advanceRound();
  }
}

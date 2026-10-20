"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ensureAnonymousSession, getSupabase, isSupabaseConfigured } from "../supabase/client";
import { errorMessage, executeAction, fetchGameState } from "./api";
import type { ConnectionState, GameAction, GameState } from "./types";

export function useGame() {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pending, setPending] = useState<GameAction["type"] | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const mounted = useRef(false);
  const actionInFlight = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const refreshAgain = useRef(false);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    if (inFlight.current) {
      refreshAgain.current = true;
      return inFlight.current;
    }
    inFlight.current = (async () => {
      do {
        refreshAgain.current = false;
        try {
          await ensureAnonymousSession();
          const next = await fetchGameState();
          if (mounted.current) {
            setState((previous) => !previous || next.revision >= previous.revision ? next : previous);
            setSyncError(null);
          }
        } catch (cause) {
          if (mounted.current) setSyncError(errorMessage(cause));
        }
      } while (refreshAgain.current && mounted.current);
    })();
    try { await inFlight.current; }
    finally { inFlight.current = null; }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    mounted.current = true;
    let disposed = false;
    let connecting = false;
    let subscribed = false;
    const supabase = getSupabase();
    let channel: ReturnType<typeof supabase.channel> | undefined;

    async function connect() {
      if (connecting || channel || disposed) return;
      connecting = true;
      try {
        await ensureAnonymousSession();
        if (disposed) return;
        const { data } = await supabase.auth.getSession();
        if (data.session) await supabase.realtime.setAuth(data.session.access_token);
        if (disposed) return;
        const nextChannel = supabase.channel("shared-room-notifications");
        channel = nextChannel;
        nextChannel
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "room_state", filter: "id=eq.1" }, () => { void refresh(); })
          .subscribe((status) => {
            if (disposed || channel !== nextChannel) return;
            if (status === "SUBSCRIBED") {
              subscribed = true;
              setConnection(navigator.onLine ? "live" : "offline");
              void refresh(); // A feliratkozás előtti változások sem vesznek el.
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
              subscribed = false;
              setConnection(navigator.onLine ? "reconnecting" : "offline");
              if (status === "CLOSED") {
                // A lezárt csatornát az SDK eltávolítja, nem csatlakoztatja újra.
                // Online eseménykor vagy a biztonsági időzítőn újra létrehozzuk.
                channel = undefined;
                void supabase.removeChannel(nextChannel);
              }
            }
          });
        await refresh();
      } catch (cause) {
        if (!disposed) {
          setSyncError(errorMessage(cause));
          setConnection(navigator.onLine ? "reconnecting" : "offline");
        }
      } finally {
        connecting = false;
      }
    }

    void connect();
    const onOnline = () => { setConnection(subscribed ? "live" : "reconnecting"); void connect(); void refresh(); };
    const onOffline = () => setConnection("offline");
    const onFocus = () => { if (!document.hidden) void refresh(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    // Biztonsági visszaolvasás, ha egy Realtime-üzenet megszakadáskor kimarad.
    const timer = window.setInterval(() => {
      if (navigator.onLine && !document.hidden) { void connect(); void refresh(); }
    }, 12_000);
    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") queueMicrotask(() => { if (!disposed) void refresh(); });
    });
    if (!navigator.onLine) queueMicrotask(() => { if (!disposed) setConnection("offline"); });

    return () => {
      disposed = true;
      mounted.current = false;
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      authListener.subscription.unsubscribe();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [refresh]);

  const act = useCallback(async (action: GameAction): Promise<boolean> => {
    if (actionInFlight.current) return false;
    actionInFlight.current = true;
    setPending(action.type);
    setError(null);
    let success = false;
    try {
      await executeAction(action);
      success = true;
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
    } finally {
      await refresh(); // Hálózati hiba után is a szerver dönti el, megtörtént-e a lépés.
      actionInFlight.current = false;
      if (mounted.current) setPending(null);
    }
    return success;
  }, [refresh]);

  return {
    state, pending, connection, error, syncError, refresh, act,
    clearError: () => setError(null),
  };
}

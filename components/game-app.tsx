"use client";

import { ArrowRight, Check, CircleHelp, Hourglass, Layers3, LoaderCircle, Radio, RotateCcw, Trophy, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { useGame } from "@/lib/game/use-game";
import type { ConnectionState, GameAction, GameState } from "@/lib/game/types";
import { EventCard } from "./event-card";
import { Hand } from "./hand";
import { JoinScreen } from "./join-screen";
import { Players } from "./players";
import { RoundResult } from "./round-result";
import { ScoreForm } from "./score-form";
import { Button, ErrorBanner, SectionHeading } from "./ui";

type Act = (action: GameAction) => Promise<boolean>;

function Connection({ status }: { status: ConnectionState }) {
  const labels = { connecting: "Kapcsolódás", live: "Élő asztal", reconnecting: "Újracsatlakozás", offline: "Nincs internet" };
  return <span role="status" className="flex items-center gap-1.5 text-[10px] font-bold sm:text-xs">
    {status === "live" ? <span className="size-2 rounded-full bg-[#779049]" />
      : status === "offline" ? <WifiOff className="size-3.5 text-[#9e432a]" aria-hidden="true" />
        : <LoaderCircle className="size-3.5 animate-spin text-muted" aria-hidden="true" />}
    {labels[status]}
  </span>;
}

function Shell({ children, connection, nickname }: { children: ReactNode; connection?: ConnectionState; nickname?: string }) {
  return <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 sm:px-8">
    <a href="#game-content" className="sr-only focus:not-sr-only focus:mt-3 focus:rounded-xl focus:bg-lime focus:p-3">Ugrás a játékhoz</a>
    <header className="flex min-h-24 items-center justify-between gap-3 border-b border-line py-4 sm:min-h-28">
      <div className="flex items-center gap-2.5"><span className="grid size-10 shrink-0 -rotate-6 place-items-center rounded-xl bg-ink text-lime"><Layers3 className="size-5" strokeWidth={2.5} aria-hidden="true" /></span><div><p className="text-xl leading-none font-black tracking-[-.06em] sm:text-2xl">SZAR ÜGY<span className="text-[#8061af]">.</span></p><p className="mt-1.5 text-[9px] font-bold tracking-[.12em] text-muted uppercase">Mennyire rossz szerinted?</p></div></div>
      <div className="min-w-0 text-right">{connection && <Connection status={connection} />}{nickname && <p className="mt-1 max-w-32 truncate text-xs text-muted">{nickname}</p>}</div>
    </header>
    <main id="game-content" className="flex-1 py-7 sm:py-10">{children}</main>
    <footer className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-[10px] font-medium text-muted"><span>Nincs jó válasz. Csak rossz történetek.</span><span>3 kezdőlap → 10 lap → győzelem</span></footer>
  </div>;
}

function Setup() {
  return <Shell><section className="panel mx-auto max-w-xl p-6 sm:p-8"><span className="badge mb-5 bg-lilac">Még egy kis előkészület</span><h1 className="text-3xl font-black tracking-tight">Az asztal készen áll.<br />Kösd hozzá a Supabase-t.</h1><p className="mt-4 text-sm leading-relaxed text-muted">Ez nem szimulált játék: valódi adatbázis és névtelen belépés szükséges hozzá.</p><ol className="mt-6 list-decimal space-y-3 pl-5 text-sm leading-relaxed"><li>Másold a <code>.env.example</code> fájlt <code>.env.local</code> néven.</li><li>Add meg a <code className="break-all">NEXT_PUBLIC_SUPABASE_URL</code> és <code className="break-all">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> értékét.</li><li>Engedélyezd az Anonymous Authenticationt, futtasd az SQL-migrációt, majd importáld az eseményeket.</li><li>Indítsd újra a fejlesztői szervert.</li></ol><p className="mt-6 border-t border-line pt-5 text-xs leading-relaxed text-muted">A pontos lépések és a Vercel telepítése a projekt magyar README.md fájljában találhatók. A service role kulcs nem kerülhet a böngészőbe.</p></section></Shell>;
}

function Lobby({ state, act, disabled, pending }: { state: GameState; act: Act; disabled: boolean; pending: GameAction["type"] | null }) {
  const enoughEvents = state.events_available >= state.events_required;
  return <div className="enter mx-auto max-w-2xl">
    <SectionHeading label="01 / A vihar előtti csend" title="Mindenki itt van?">Szóljatok egymásnak, ha készen álltok. Bárki indíthat; nem kell pontosan hatan lennetek.</SectionHeading>
    <Players state={state} lobby />
    <div className="mt-5 rounded-2xl border border-line p-5"><h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold"><CircleHelp className="size-4" aria-hidden="true" />Egy percben a szabályok</h2><ol className="list-decimal space-y-2 pl-4 text-sm leading-relaxed text-muted"><li>Három saját lapot pontozol, 1-től 100-ig.</li><li>A körödben te elhelyezel, mindenki más titokban pontoz.</li><li>Az átlag dönti el, jó helyre tetted-e. Az első 10 lapos nyer.</li></ol></div>
    {!enoughEvents && <p role="status" className="mt-5 rounded-xl bg-coral/35 p-4 text-sm leading-relaxed">Ehhez a létszámhoz {state.events_required} aktív esemény kell, most {state.events_available} van. Töltsetek fel továbbiakat a Supabase-ba.</p>}
    <Button className="mt-6 w-full" onClick={() => { void act({ type: "start", gameId: state.game.id }); }} disabled={disabled || state.player_count < 2 || !enoughEvents} busy={pending === "start"}>Játék indítása<ArrowRight className="size-4" aria-hidden="true" /></Button>
    <p className="mt-3 text-center text-xs leading-relaxed text-muted">{state.player_count < 2 ? "Legalább még egy játékosra várunk." : "Indításkor lezárjuk a játékoslistát, és kisorsoljuk a kezdőt."}</p>
  </div>;
}

function InitialRating({ state, act, disabled, pending }: { state: GameState; act: Act; disabled: boolean; pending: GameAction["type"] | null }) {
  const card = state.initial_card;
  const ready = state.players.filter((player) => player.initial_rated === 3).length;
  return <div className="enter">
    <SectionHeading label="02 / Állítsd be az ingerküszöböd" title={card ? "A te életed, a te mércéd." : "A te lapjaid már rendben."}>{card ? "Pontozd a három kezdőkártyádat. Itt nincs átlag: mindegyiknél csak a te véleményed számít." : "Amint mindenki végez, automatikusan indul az első kör."}</SectionHeading>
    <Players state={state} />
    <div className="grid items-start gap-6 md:grid-cols-2">
      {card ? <div className="space-y-4"><EventCard key={card.id} event={card.event} label={`Kezdőkártya · ${card.order}/3`} initial /><ScoreForm key={`score-${card.id}`} initial busy={pending === "initial"} disabled={disabled} onSubmit={(score) => { void act({ type: "initial", gameId: state.game.id, cardId: card.id, score }); }} /></div>
        : <section className="panel flex flex-col items-center p-8 text-center sm:p-10"><span className="mb-5 grid size-16 place-items-center rounded-full bg-lime"><Hourglass className="size-7" aria-hidden="true" /></span><h2 className="text-xl font-black">Várakozás a többi játékosra...</h2><p className="mt-3 text-sm text-muted">{ready}/{state.player_count} játékos végzett.</p><progress className="mt-6" value={ready} max={state.player_count} aria-label="Elkészült játékosok" /></section>}
      <Hand cards={state.my_cards} />
    </div>
  </div>;
}

function RatingProgress({ count, expected }: { count: number; expected: number }) {
  return <div className="rounded-2xl border border-line bg-white/60 p-4" role="status">
    <div className="mb-2.5 flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-2 font-bold"><Radio className="size-3.5" aria-hidden="true" />{count === expected ? "Minden pontszám megérkezett" : "A többiek titokban pontoznak"}</span><span className="shrink-0 font-bold tabular-nums">{count}/{expected}</span></div>
    <progress value={count} max={expected} aria-label={`${count}/${expected} játékos értékelt`} />
  </div>;
}

function Playing({ state, act, disabled, pending }: { state: GameState; act: Act; disabled: boolean; pending: GameAction["type"] | null }) {
  const round = state.current_round;
  if (!round) return <p role="status">A következő kör betöltése...</p>;
  const active = state.players.find((player) => player.id === round.active_player_id);
  const isActive = round.active_player_id === state.me_id;
  const allRated = round.ratings_count === round.ratings_expected;
  const selected = round.selected_position !== null;

  return <div className="enter">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow mb-1 text-muted">{round.number}. kör · {isActive ? "Most te jössz" : "Most te pontozol"}</p><h1 className="text-3xl font-black tracking-tight">{isActive ? "Hová fér még egy szar ügy?" : `${active?.nickname} köre`}</h1></div>{isActive && <span className="badge bg-lime">Te vagy soron</span>}</div>
    <Players state={state} />
    {state.latest_result && <RoundResult key={state.latest_result.id} result={state.latest_result} players={state.players} autoReveal />}
    <div className="grid items-start gap-6 md:grid-cols-2">
      <div className="space-y-4">
        <EventCard key={round.id} event={round.event} />
        <RatingProgress count={round.ratings_count} expected={round.ratings_expected} />
        {isActive ? <div className="rounded-2xl bg-ink p-5 text-white"><span className="eyebrow text-lime">Ne pontozz. Tippelj.</span><p className="mt-2 text-sm leading-relaxed text-white/75">Hová kerül szerinted a többiek átlaga a saját lapjaid között? Jelölj ki egy helyet {allRated ? "a kártyasorodban" : "akár már a pontozás közben"}, majd véglegesíts.</p></div>
          : round.my_rating === null ? <ScoreForm key={`rating-${round.id}`} busy={pending === "rate"} disabled={disabled} onSubmit={(score) => { void act({ type: "rate", gameId: state.game.id, roundId: round.id, score }); }} />
            : <div className="panel p-6 text-center"><span className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-lime"><Check className="size-5" aria-hidden="true" /></span><h2 className="text-lg font-black">Pontszám elküldve.</h2><p className="mt-2 text-sm text-muted">A te értékelésed: <strong className="text-ink">{round.my_rating}/100</strong></p><p className="mt-3 text-xs leading-relaxed text-muted">{allRated ? `Már csak ${active?.nickname} elhelyezésére várunk.` : "Várakozás a többi értékelésre és az elhelyezésre."} A kör végén minden véleményt felfedünk.</p></div>}
      </div>
      <div className="space-y-4">
        <Hand cards={state.my_cards} selected={round.selected_position} disabled={disabled}
          onSelect={isActive ? (position) => { void act({ type: "select", gameId: state.game.id, roundId: round.id, position }); } : undefined} />
        {isActive && <div className="rounded-2xl border border-line bg-paper p-4">
          <Button className="w-full" disabled={disabled || !allRated || !selected} busy={pending === "finalize"} onClick={() => { void act({ type: "finalize", gameId: state.game.id, roundId: round.id }); }}>Elhelyezés véglegesítése<Check className="size-4" aria-hidden="true" /></Button>
          <p className="mt-3 text-center text-xs leading-relaxed text-muted">{!selected ? "Válassz egy beillesztési helyet a lapjaid között." : !allRated ? "A helyed elmentve. Várjuk a többi értékelést." : "Minden értékelés megérkezett. Jöhet az igazság pillanata."}</p>
        </div>}
      </div>
    </div>
  </div>;
}

function Finished({ state, act, disabled, pending }: { state: GameState; act: Act; disabled: boolean; pending: GameAction["type"] | null }) {
  const winner = state.players.find((player) => player.id === state.game.winner_id);
  return <div className="enter mx-auto max-w-2xl">
    <section className={`mb-6 rounded-3xl p-7 text-center sm:p-10 ${winner ? "bg-lime" : "bg-coral/60"}`}>
      <Trophy className="mx-auto mb-5 size-12" strokeWidth={1.5} aria-hidden="true" /><p className="eyebrow mb-3">{winner ? "10 lap. Ezt is túléltük." : "Elfogytak a történetek."}</p><h1 className="text-4xl font-black tracking-tight">{winner ? `${winner.nickname} nyert!` : "A parti lezárult."}</h1><p className="mt-4 text-sm leading-relaxed">{winner ? "A legjobb helyre tette a legrosszabb dolgokat." : "Nincs több aktív, szabadon húzható esemény. Nincs győztes; adjatok hozzá új eseményeket, majd nyissatok új játékot."}</p>
    </section>
    <section className="panel mb-6 p-5 sm:p-6"><h2 className="mb-4 font-extrabold">Így állt meg az élet</h2><ul className="divide-y divide-line">{[...state.players].sort((a, b) => b.card_count - a.card_count || a.join_order - b.join_order).map((player) => <li key={player.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span className="flex items-center gap-2 font-bold">{player.id === state.game.winner_id && <Trophy className="size-4" aria-label="Győztes" />}{player.nickname}{player.id === state.me_id && <span className="text-xs font-normal text-muted">(te)</span>}</span><span className="font-extrabold tabular-nums">{player.card_count} lap</span></li>)}</ul></section>
    {state.latest_result && <RoundResult key={state.latest_result.id} result={state.latest_result} players={state.players} gameFinished />}
    <Button className="w-full" onClick={() => { void act({ type: "restart", gameId: state.game.id }); }} disabled={disabled} busy={pending === "restart"}><RotateCcw className="size-4" aria-hidden="true" />Új játék – vissza a váróba</Button><p className="mt-3 text-center text-xs leading-relaxed text-muted">Tiszta lapokkal kezdünk. A többiek a saját becenevükkel újra csatlakozhatnak.</p>
  </div>;
}

export function GameApp() {
  const game = useGame();
  if (!isSupabaseConfigured) return <Setup />;
  const { state, pending, connection, act } = game;
  const nickname = state?.players.find((player) => player.id === state.me_id)?.nickname;
  const disabled = pending !== null || connection === "offline";
  const screenProps = state ? { state, act, disabled, pending } : null;

  return <Shell connection={connection} nickname={nickname}>
    {connection === "offline" && <div className="mb-5 rounded-xl bg-coral/35 p-4 text-sm leading-relaxed" role="status">Megszakadt a kapcsolat. A lapjaid megmaradnak; visszacsatlakozáskor automatikusan szinkronizálunk.</div>}
    {game.error && <ErrorBanner message={game.error} onDismiss={game.clearError} />}
    {game.syncError && <div><ErrorBanner message={game.syncError} /><Button className="mb-5" variant="secondary" onClick={() => { void game.refresh(); }}>Kapcsolat újrapróbálása</Button></div>}
    {!state ? <div className="flex min-h-72 flex-col items-center justify-center gap-4 text-center" role="status"><LoaderCircle className="size-8 animate-spin text-[#8061af]" aria-hidden="true" /><h1 className="text-xl font-black">Visszatérés az asztalhoz...</h1><p className="text-sm text-muted">A böngésződ megőrzi a névtelen azonosítódat.</p></div>
      : !state.me_id ? <JoinScreen key={state.game.id} state={state} disabled={disabled} busy={pending === "join"} onJoin={(name) => { void act({ type: "join", gameId: state.game.id, nickname: name }); }} />
        : screenProps && state.game.status === "lobby" ? <Lobby {...screenProps} />
          : screenProps && state.game.status === "initial_rating" ? <InitialRating {...screenProps} />
            : screenProps && state.game.status === "playing" ? <Playing {...screenProps} />
              : screenProps && <Finished {...screenProps} />}
  </Shell>;
}

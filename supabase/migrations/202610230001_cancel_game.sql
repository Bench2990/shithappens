-- Meglévő adatbázisra is alkalmazható: a korábbi partik, lapok, körök és
-- értékelések megmaradnak. A megszakítás új, üres lobbyt nyit ugyanazokkal
-- az Auth-felhasználókkal; a játékosazonosítók továbbra is partinként különülnek el.
begin;

alter table public.games
  drop constraint games_end_reason_check,
  add constraint games_end_reason_check check (end_reason in ('winner', 'exhausted', 'cancelled')),
  add column cancelled_by_player_id uuid,
  add column cancelled_from_game_id uuid unique references public.games(id),
  add constraint games_cancelled_by_player_fkey
    foreign key (cancelled_by_player_id, id) references public.players(id, game_id),
  add constraint games_cancelled_by_check check (
    (end_reason is not distinct from 'cancelled') = (cancelled_by_player_id is not null)
  );

create function public.cancel_game(p_game_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user(); v_current uuid; v_player uuid;
  v_game public.games%rowtype; v_new uuid;
begin
  -- Ugyanaz a zár és zárolási sorrend, mint minden más módosító RPC-ben.
  select current_game_id into v_current from public.room_state where id = 1 for update;
  select id into v_player from public.players where game_id = p_game_id and user_id = v_user;
  if v_player is null then raise exception 'Csak a parti résztvevője szakíthatja meg a játékot.'; end if;
  select * into v_game from public.games where id = p_game_id;

  if v_current is distinct from p_game_id then
    -- Két egyidejű kérés vagy hálózati újrapróbálás nem nyit újabb lobbyt,
    -- és egy későbbi partit sem szakíthat meg. Az első kezdeményező marad meg.
    if v_game.end_reason = 'cancelled' then return v_current; end if;
    raise exception 'Már másik parti van az asztalon.';
  end if;
  if v_game.status not in ('initial_rating', 'playing') then
    raise exception 'Csak folyamatban lévő partit szakíthatsz meg.';
  end if;

  insert into public.games (cancelled_from_game_id) values (p_game_id) returning id into v_new;
  insert into public.players (game_id, user_id, nickname, join_order)
    select v_new, user_id, nickname, join_order from public.players
    where game_id = p_game_id order by join_order;
  update public.games set status = 'finished', end_reason = 'cancelled',
    finished_at = now(), current_player_id = null, cancelled_by_player_id = v_player
    where id = p_game_id;

  -- Az előzménybeli nyitott körhöz sem nyúlunk. A régi játékazonosítóval
  -- érkező RPC-k a szobazár megszerzése után már nem juthatnak el hozzá.
  update public.room_state set current_game_id = v_new where id = 1;
  perform private.touch_room();
  return v_new;
end;
$$;

-- Az eredeti, jogosultságszűrt pillanatkép változatlan játéklogikával,
-- kiegészítve a lobby résztvevőinek szóló megszakítási tájékoztatóval.
create or replace function public.get_game_state() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user(); v_room public.room_state%rowtype; v_game public.games%rowtype;
  v_me uuid; v_players jsonb := '[]'::jsonb; v_cards jsonb := '[]'::jsonb;
  v_initial jsonb; v_round jsonb; v_result jsonb; v_player_count integer; v_available integer;
  v_cancellation jsonb;
begin
  select * into v_room from public.room_state where id = 1;
  select * into v_game from public.games where id = v_room.current_game_id;
  select id into v_me from public.players where game_id = v_game.id and user_id = v_user;
  select count(*) into v_player_count from public.players where game_id = v_game.id;
  select count(*) into v_available from public.events where active;

  if v_me is not null or v_game.status = 'lobby' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'nickname', p.nickname, 'join_order', p.join_order,
      'card_count', (select count(*) from public.player_cards c where c.player_id = p.id),
      'initial_rated', (select count(*) from public.player_cards c
        where c.player_id = p.id and c.source = 'initial' and c.score_tenths is not null)
    ) order by p.join_order), '[]'::jsonb) into v_players
    from public.players p where p.game_id = v_game.id;
  end if;

  if v_me is not null then
    if v_game.status = 'lobby' then
      select jsonb_build_object('game_id', g.id, 'nickname', p.nickname, 'cancelled_at', g.finished_at)
        into v_cancellation
      from public.games g join public.players p on p.id = g.cancelled_by_player_id and p.game_id = g.id
      where g.id = v_game.cancelled_from_game_id and g.end_reason = 'cancelled';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'event', jsonb_build_object('id', e.id, 'title', e.title, 'description', e.description),
      'score_tenths', c.score_tenths, 'source', c.source
    ) order by c.score_tenths, c.id), '[]'::jsonb) into v_cards
    from public.player_cards c join public.events e on e.id = c.event_id
    where c.player_id = v_me and c.score_tenths is not null;

    if v_game.status = 'initial_rating' then
      select jsonb_build_object('id', c.id, 'order', c.initial_order,
        'event', jsonb_build_object('id', e.id, 'title', e.title, 'description', e.description)) into v_initial
      from public.player_cards c join public.events e on e.id = c.event_id
      where c.player_id = v_me and c.score_tenths is null order by c.initial_order limit 1;
    end if;

    if v_game.status = 'playing' then
      select jsonb_build_object(
        'id', r.id, 'number', r.number, 'active_player_id', r.active_player_id,
        'event', jsonb_build_object('id', e.id, 'title', e.title, 'description', e.description),
        'ratings_count', (select count(*) from public.ratings t where t.round_id = r.id),
        'ratings_expected', v_player_count - 1,
        'my_rating', (select t.value from public.ratings t where t.round_id = r.id and t.player_id = v_me),
        'selected_position', case when r.active_player_id = v_me then r.selected_position else null end
      ) into v_round
      from public.rounds r join public.events e on e.id = r.event_id
      where r.game_id = v_game.id and r.status = 'open';
    end if;

    select jsonb_build_object(
      'id', r.id, 'number', r.number, 'active_player_id', r.active_player_id,
      'event', jsonb_build_object('id', e.id, 'title', e.title, 'description', e.description),
      'average_tenths', r.average_tenths, 'selected_position', r.selected_position,
      'lower_tenths', r.lower_tenths, 'upper_tenths', r.upper_tenths,
      'correct', r.correct, 'card_count_after', r.card_count_after,
      'ratings', (select coalesce(jsonb_agg(jsonb_build_object(
        'player_id', p.id, 'nickname', p.nickname, 'value', t.value
      ) order by p.join_order), '[]'::jsonb)
      from public.ratings t join public.players p on p.id = t.player_id where t.round_id = r.id)
    ) into v_result
    from public.rounds r join public.events e on e.id = r.event_id
    where r.game_id = v_game.id and r.status = 'closed' order by r.number desc limit 1;
  end if;

  return jsonb_build_object(
    'revision', v_room.revision, 'me_id', v_me, 'player_count', v_player_count,
    'events_available', v_available, 'events_required', v_player_count * 9 + 1,
    'game', jsonb_build_object('id', v_game.id, 'status', v_game.status,
      'starting_player_id', v_game.starting_player_id, 'current_player_id', v_game.current_player_id,
      'winner_id', v_game.winner_id, 'end_reason', v_game.end_reason, 'round_number', v_game.round_number),
    'players', v_players, 'my_cards', v_cards, 'initial_card', v_initial,
    'current_round', v_round, 'latest_result', v_result, 'cancellation', v_cancellation
  );
end;
$$;

revoke all on function public.cancel_game(uuid) from public, anon, authenticated;
grant execute on function public.cancel_game(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;

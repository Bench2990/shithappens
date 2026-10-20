-- Minden játéklépés egy RPC-tranzakció. A közös szoba sorzárja a
-- csatlakozásokat, pontozásokat és körváltásokat is sorba rendezi.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null unique check (char_length(title) between 3 and 160),
  description text not null check (char_length(description) between 5 and 1000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'lobby'
    check (status in ('lobby', 'initial_rating', 'playing', 'finished')),
  starting_player_id uuid,
  current_player_id uuid,
  winner_id uuid,
  round_number integer not null default 0 check (round_number >= 0),
  end_reason text check (end_reason in ('winner', 'exhausted')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  check ((status = 'finished') = (finished_at is not null)),
  check ((status = 'finished') = (end_reason is not null)),
  check ((end_reason is not distinct from 'winner') = (winner_id is not null))
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id),
  user_id uuid not null references auth.users(id),
  nickname text not null check (
    char_length(nickname) between 2 and 24
    and nickname = btrim(nickname) and nickname !~ '[[:cntrl:]]'
  ),
  join_order integer not null check (join_order > 0),
  created_at timestamptz not null default now(),
  unique (game_id, user_id),
  unique (game_id, join_order),
  unique (id, game_id)
);
create unique index players_game_nickname on public.players (game_id, lower(nickname));
create index players_auth on public.players (user_id);

alter table public.games
  add foreign key (starting_player_id, id) references public.players(id, game_id),
  add foreign key (current_player_id, id) references public.players(id, game_id),
  add foreign key (winner_id, id) references public.players(id, game_id);

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id),
  number integer not null check (number > 0),
  active_player_id uuid not null,
  event_id uuid not null references public.events(id),
  status text not null default 'open' check (status in ('open', 'closed')),
  selected_position integer check (selected_position >= 0),
  -- Tizedpontok: 67,4 = 674. Soha nem használunk float összehasonlítást.
  average_tenths integer check (average_tenths between 10 and 1000),
  lower_tenths integer check (lower_tenths between 10 and 1000),
  upper_tenths integer check (upper_tenths between 10 and 1000),
  correct boolean,
  card_count_after integer check (card_count_after between 3 and 10),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  foreign key (active_player_id, game_id) references public.players(id, game_id),
  unique (game_id, number),
  unique (id, game_id),
  check (
    (status = 'open' and closed_at is null and correct is null and card_count_after is null)
    or (status = 'closed' and closed_at is not null and correct is not null
      and card_count_after is not null and average_tenths is not null
      and selected_position is not null)
  )
);
create unique index one_open_round on public.rounds (game_id) where status = 'open';
create index rounds_history on public.rounds (game_id, number desc) where status = 'closed';

create table public.player_cards (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id),
  player_id uuid not null,
  event_id uuid not null references public.events(id),
  score_tenths integer check (score_tenths between 10 and 1000),
  source text not null check (source in ('initial', 'won')),
  initial_order integer,
  round_id uuid unique,
  created_at timestamptz not null default now(),
  foreign key (player_id, game_id) references public.players(id, game_id),
  foreign key (round_id, game_id) references public.rounds(id, game_id),
  unique (game_id, event_id),
  check (
    (source = 'initial' and initial_order between 1 and 3 and initial_order is not null
      and round_id is null and (score_tenths is null or score_tenths % 10 = 0))
    or (source = 'won' and initial_order is null and round_id is not null and score_tenths is not null)
  )
);
create unique index initial_card_slots on public.player_cards (player_id, initial_order)
  where source = 'initial';
create index cards_sorted on public.player_cards (player_id, score_tenths, id);

create table public.ratings (
  game_id uuid not null references public.games(id),
  round_id uuid not null,
  player_id uuid not null,
  value integer not null check (value between 1 and 100),
  created_at timestamptz not null default now(),
  primary key (round_id, player_id),
  foreign key (round_id, game_id) references public.rounds(id, game_id),
  foreign key (player_id, game_id) references public.players(id, game_id)
);
create index ratings_player on public.ratings (player_id);

-- Ez az egyetlen, kliens által közvetlenül olvasható és Realtime-ra publikált tábla.
-- Kizárólag változásjelzés: sem pontszám, sem becenév, sem kártya nincs benne.
create table public.room_state (
  id integer primary key default 1 check (id = 1),
  current_game_id uuid not null references public.games(id),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
with game as (insert into public.games default values returning id)
insert into public.room_state (current_game_id) select id from game;

alter table public.events enable row level security;
alter table public.games enable row level security;
alter table public.players enable row level security;
alter table public.rounds enable row level security;
alter table public.player_cards enable row level security;
alter table public.ratings enable row level security;
alter table public.room_state enable row level security;

revoke all on table public.events, public.games, public.players, public.rounds,
  public.player_cards, public.ratings, public.room_state from public, anon, authenticated;
grant select on public.room_state to authenticated;
create policy room_notification_read on public.room_state for select to authenticated
  using ((select auth.uid()) is not null);
grant all on table public.events, public.games, public.players, public.rounds,
  public.player_cards, public.ratings, public.room_state to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_state'
    ) then
    alter publication supabase_realtime add table public.room_state;
  end if;
end;
$$;

create function private.require_user() returns uuid
language plpgsql stable set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Azonosítás szükséges. Nyisd meg újra az oldalt.';
  end if;
  return v_user;
end;
$$;

create function private.touch_room() returns void
language sql set search_path = '' as $$
  update public.room_state set revision = revision + 1, updated_at = clock_timestamp() where id = 1;
$$;

create function private.average_tenths(p_values integer[]) returns integer
language plpgsql immutable set search_path = '' as $$
begin
  if p_values is null or cardinality(p_values) = 0 or exists (
    select 1 from unnest(p_values) as v where v is null or v < 1 or v > 100
  ) then
    raise exception 'Érvénytelen pontszámok.';
  end if;
  return (select round(sum(v)::numeric * 10 / count(v))::integer from unnest(p_values) as v);
end;
$$;

create function private.placement_correct(p_cards integer[], p_score integer, p_position integer)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    p_cards is not null and p_score between 10 and 1000
    and p_position between 0 and cardinality(p_cards)
    and (p_position = 0 or p_cards[p_position] <= p_score)
    and (p_position = cardinality(p_cards) or p_score <= p_cards[p_position + 1]), false);
$$;

create function private.next_player(p_game_id uuid, p_current_id uuid) returns uuid
language sql stable set search_path = '' as $$
  select p.id from public.players p
  where p.game_id = p_game_id
  order by
    case when p.join_order > (
      select c.join_order from public.players c where c.id = p_current_id and c.game_id = p_game_id
    ) then 0 else 1 end,
    p.join_order
  limit 1;
$$;

-- Csak a szobazárat már birtokló játéklépések hívhatják.
create function private.begin_round(p_game_id uuid, p_player_id uuid) returns void
language plpgsql set search_path = '' as $$
declare v_event uuid; v_number integer;
begin
  select e.id into v_event from public.events e
  where e.active and not exists (
    select 1 from public.player_cards c where c.game_id = p_game_id and c.event_id = e.id
  ) order by random() limit 1;
  if v_event is null then
    update public.games set status = 'finished', end_reason = 'exhausted',
      finished_at = now(), current_player_id = null where id = p_game_id;
    return;
  end if;
  update public.games set round_number = round_number + 1, current_player_id = p_player_id
    where id = p_game_id returning round_number into v_number;
  insert into public.rounds (game_id, number, active_player_id, event_id)
    values (p_game_id, v_number, p_player_id, v_event);
end;
$$;

create function public.join_game(p_game_id uuid, p_nickname text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user(); v_game uuid; v_player uuid;
  v_name text := btrim(p_nickname); v_order integer;
begin
  select current_game_id into v_game from public.room_state where id = 1 for update;
  if v_game is distinct from p_game_id then raise exception 'Új parti nyílt. Próbáld újra a csatlakozást.'; end if;
  select id into v_player from public.players where game_id = v_game and user_id = v_user;
  if v_player is not null then return v_player; end if;
  if (select status from public.games where id = v_game) <> 'lobby' then
    raise exception 'Ez a parti már elindult. Várd meg a következő játékot.';
  end if;
  if v_name is null or char_length(v_name) not between 2 and 24 or v_name ~ '[[:cntrl:]]' then
    raise exception 'A becenév 2–24 látható karakter legyen.';
  end if;
  if exists (select 1 from public.players where game_id = v_game and lower(nickname) = lower(v_name)) then
    raise exception 'Ezt a becenevet már használja valaki.';
  end if;
  select coalesce(max(join_order), 0) + 1 into v_order from public.players where game_id = v_game;
  insert into public.players (game_id, user_id, nickname, join_order)
    values (v_game, v_user, v_name, v_order) returning id into v_player;
  perform private.touch_room();
  return v_player;
end;
$$;

create function public.start_game(p_game_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user(); v_game uuid; v_count integer; v_available integer;
  v_start uuid; v_events uuid[]; v_player record; v_index integer := 1; v_slot integer;
begin
  select current_game_id into v_game from public.room_state where id = 1 for update;
  if v_game is distinct from p_game_id then raise exception 'Már másik parti van az asztalon.'; end if;
  if not exists (select 1 from public.players where game_id = v_game and user_id = v_user) then
    raise exception 'Előbb csatlakozz a játékhoz.';
  end if;
  if (select status from public.games where id = v_game) <> 'lobby' then return; end if;
  select count(*) into v_count from public.players where game_id = v_game;
  if v_count < 2 then raise exception 'Legalább két játékosra van szükség.'; end if;
  select count(*) into v_available from public.events where active;
  -- N * 9 + 1 esemény biztosítja, hogy valaki elérhesse a 10 lapot.
  if v_available < v_count * 9 + 1 then
    raise exception 'Nincs elég aktív esemény: % szükséges, % elérhető.', v_count * 9 + 1, v_available;
  end if;
  select id into v_start from public.players where game_id = v_game order by random() limit 1;
  update public.games set status = 'initial_rating', starting_player_id = v_start,
    current_player_id = v_start, started_at = now() where id = v_game;
  v_events := array(select id from public.events where active order by random() limit v_count * 3);
  for v_player in select id from public.players where game_id = v_game order by join_order loop
    for v_slot in 1..3 loop
      insert into public.player_cards (game_id, player_id, event_id, source, initial_order)
        values (v_game, v_player.id, v_events[v_index], 'initial', v_slot);
      v_index := v_index + 1;
    end loop;
  end loop;
  perform private.touch_room();
end;
$$;

create function public.rate_initial_card(p_game_id uuid, p_card_id uuid, p_score integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user(); v_game uuid; v_card public.player_cards%rowtype; v_next uuid;
begin
  select current_game_id into v_game from public.room_state where id = 1 for update;
  if v_game is distinct from p_game_id then raise exception 'Már másik parti van az asztalon.'; end if;
  if p_score is null or p_score not between 1 and 100 then raise exception 'A pontszám 1 és 100 közötti egész szám legyen.'; end if;
  select c.* into v_card from public.player_cards c join public.players p on p.id = c.player_id
    where c.id = p_card_id and c.game_id = v_game and p.user_id = v_user and c.source = 'initial';
  if not found then raise exception 'Csak a saját kezdőkártyádat pontozhatod.'; end if;
  if v_card.score_tenths is not null then
    if v_card.score_tenths <> p_score * 10 then raise exception 'Ezt a pontszámot már véglegesítetted.'; end if;
    return;
  end if;
  if (select status from public.games where id = v_game) <> 'initial_rating' then
    raise exception 'A kezdőpontozás már lezárult.';
  end if;
  select id into v_next from public.player_cards where player_id = v_card.player_id
    and source = 'initial' and score_tenths is null order by initial_order limit 1;
  if v_next <> p_card_id then raise exception 'Előbb az aktuális kezdőkártyádat értékeld.'; end if;
  update public.player_cards set score_tenths = p_score * 10 where id = p_card_id;
  if not exists (select 1 from public.player_cards where game_id = v_game and score_tenths is null) then
    update public.games set status = 'playing' where id = v_game;
    perform private.begin_round(v_game, (select starting_player_id from public.games where id = v_game));
  end if;
  perform private.touch_room();
end;
$$;

create function public.rate_round(p_game_id uuid, p_round_id uuid, p_score integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user(); v_game uuid; v_player uuid;
  v_round public.rounds%rowtype; v_existing integer; v_count integer; v_expected integer;
begin
  select current_game_id into v_game from public.room_state where id = 1 for update;
  if v_game is distinct from p_game_id then raise exception 'Már másik parti van az asztalon.'; end if;
  select id into v_player from public.players where game_id = v_game and user_id = v_user;
  if v_player is null then raise exception 'Nem vagy ennek a partinak a játékosa.'; end if;
  select * into v_round from public.rounds where id = p_round_id and game_id = v_game;
  if not found then raise exception 'Ez a kör nem található.'; end if;
  if v_round.active_player_id = v_player then raise exception 'A saját körödben nem pontozhatsz.'; end if;
  if p_score is null or p_score not between 1 and 100 then raise exception 'A pontszám 1 és 100 közötti egész szám legyen.'; end if;
  select value into v_existing from public.ratings where round_id = p_round_id and player_id = v_player;
  if found then
    if v_existing <> p_score then raise exception 'Ezt a pontszámot már véglegesítetted.'; end if;
    return;
  end if;
  if v_round.status <> 'open' or (select status from public.games where id = v_game) <> 'playing' then
    raise exception 'Ez a kör már lezárult.';
  end if;
  insert into public.ratings (game_id, round_id, player_id, value) values (v_game, p_round_id, v_player, p_score);
  select count(*) into v_count from public.ratings where round_id = p_round_id;
  select count(*) - 1 into v_expected from public.players where game_id = v_game;
  if v_count = v_expected then
    update public.rounds set average_tenths = private.average_tenths(
      array(select value from public.ratings where round_id = p_round_id)
    ) where id = p_round_id;
  end if;
  perform private.touch_room();
end;
$$;

create function public.select_placement(p_game_id uuid, p_round_id uuid, p_position integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user(); v_game uuid; v_round public.rounds%rowtype; v_count integer;
begin
  select current_game_id into v_game from public.room_state where id = 1 for update;
  if v_game is distinct from p_game_id then raise exception 'Már másik parti van az asztalon.'; end if;
  select r.* into v_round from public.rounds r join public.players p on p.id = r.active_player_id
    where r.id = p_round_id and r.game_id = v_game and p.user_id = v_user;
  if not found then raise exception 'Csak a soron lévő játékos választhat helyet.'; end if;
  if v_round.status = 'closed' then return; end if;
  select count(*) into v_count from public.player_cards where player_id = v_round.active_player_id;
  if p_position is null or p_position not between 0 and v_count then raise exception 'Érvénytelen beillesztési hely.'; end if;
  if v_round.selected_position is distinct from p_position then
    update public.rounds set selected_position = p_position where id = p_round_id;
    perform private.touch_room();
  end if;
end;
$$;

create function public.finalize_placement(p_game_id uuid, p_round_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user(); v_game uuid; v_round public.rounds%rowtype;
  v_cards integer[]; v_correct boolean; v_count integer; v_expected integer; v_rated integer;
begin
  select current_game_id into v_game from public.room_state where id = 1 for update;
  if v_game is distinct from p_game_id then raise exception 'Már másik parti van az asztalon.'; end if;
  select r.* into v_round from public.rounds r join public.players p on p.id = r.active_player_id
    where r.id = p_round_id and r.game_id = v_game and p.user_id = v_user;
  if not found then raise exception 'Csak a soron lévő játékos véglegesíthet.'; end if;
  if v_round.status = 'closed' then return; end if;
  if (select status from public.games where id = v_game) <> 'playing' then raise exception 'A játék nem aktív.'; end if;
  select count(*) - 1 into v_expected from public.players where game_id = v_game;
  select count(*) into v_rated from public.ratings where round_id = p_round_id;
  if v_rated <> v_expected or v_round.average_tenths is null then
    raise exception 'Várd meg az összes játékos értékelését.';
  end if;
  v_cards := array(select score_tenths from public.player_cards
    where player_id = v_round.active_player_id order by score_tenths, id);
  if v_round.selected_position is null or v_round.selected_position not between 0 and cardinality(v_cards) then
    raise exception 'Előbb válaszd ki az új kártya helyét.';
  end if;
  v_correct := private.placement_correct(v_cards, v_round.average_tenths, v_round.selected_position);
  if v_correct then
    insert into public.player_cards (game_id, player_id, event_id, score_tenths, source, round_id)
      values (v_game, v_round.active_player_id, v_round.event_id, v_round.average_tenths, 'won', p_round_id);
  end if;
  select count(*) into v_count from public.player_cards where player_id = v_round.active_player_id;
  update public.rounds set status = 'closed', correct = v_correct, card_count_after = v_count,
    lower_tenths = v_cards[v_round.selected_position],
    upper_tenths = v_cards[v_round.selected_position + 1], closed_at = now() where id = p_round_id;
  if v_count >= 10 then
    update public.games set status = 'finished', winner_id = v_round.active_player_id,
      current_player_id = null, end_reason = 'winner', finished_at = now() where id = v_game;
  else
    perform private.begin_round(v_game, private.next_player(v_game, v_round.active_player_id));
  end if;
  perform private.touch_room();
end;
$$;

create function public.restart_game(p_game_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_user(); v_current uuid; v_new uuid; v_name text;
begin
  select current_game_id into v_current from public.room_state where id = 1 for update;
  select nickname into v_name from public.players where game_id = p_game_id and user_id = v_user;
  if not found then raise exception 'Csak a lezárt parti résztvevője nyithat új játékot.'; end if;
  -- Egy korábbi újraindítás ismétlése sosem nullázhatja az új partit.
  if v_current is distinct from p_game_id then return v_current; end if;
  if (select status from public.games where id = v_current) <> 'finished' then
    raise exception 'Új játékot csak az előző parti befejezése után indíthatsz.';
  end if;
  insert into public.games default values returning id into v_new;
  insert into public.players (game_id, user_id, nickname, join_order) values (v_new, v_user, v_name, 1);
  update public.room_state set current_game_id = v_new where id = 1;
  perform private.touch_room();
  return v_new;
end;
$$;

-- STABLE: a teljes válasz egyetlen adatbázis-pillanatképből áll össze.
-- A titkos mezők nem szerepelnek a nyitott kör JSON-jában, még null értékkel sem.
create function public.get_game_state() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user(); v_room public.room_state%rowtype; v_game public.games%rowtype;
  v_me uuid; v_players jsonb := '[]'::jsonb; v_cards jsonb := '[]'::jsonb;
  v_initial jsonb; v_round jsonb; v_result jsonb; v_player_count integer; v_available integer;
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
    'current_round', v_round, 'latest_result', v_result
  );
end;
$$;

-- Az alapértelmezett PUBLIC EXECUTE jogot minden saját függvényről levesszük.
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.join_game(uuid, text), public.start_game(uuid),
  public.rate_initial_card(uuid, uuid, integer), public.rate_round(uuid, uuid, integer),
  public.select_placement(uuid, uuid, integer), public.finalize_placement(uuid, uuid),
  public.restart_game(uuid), public.get_game_state() from public, anon, authenticated;
grant execute on function public.join_game(uuid, text), public.start_game(uuid),
  public.rate_initial_card(uuid, uuid, integer), public.rate_round(uuid, uuid, integer),
  public.select_placement(uuid, uuid, integer), public.finalize_placement(uuid, uuid),
  public.restart_game(uuid), public.get_game_state() to authenticated;

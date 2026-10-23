-- Kizárólag az el nem indított, aktuális lobby kezelése. A korábbi
-- migrációkat, játékokat, eredményeket és eseményeket nem módosítja.
begin;

-- A régi lobby megmarad előzményként, de a room_state már nem mutat rá.
-- Egy lobbyból legfeljebb egy új lobby nyitható reset_lobby hívással.
alter table public.games
  add column reset_from_game_id uuid unique references public.games(id);

create function public.leave_lobby(p_game_id uuid, p_player_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user(); v_current uuid; v_owner uuid;
begin
  select current_game_id into v_current from public.room_state where id = 1 for update;
  if v_current is distinct from p_game_id then raise exception 'Már másik lobby van az asztalon.'; end if;
  if (select status from public.games where id = v_current) <> 'lobby' then
    raise exception 'Kilépni csak a lobbyból lehet. A játék már elindult.';
  end if;
  if p_player_id is null then raise exception 'Érvénytelen lobbytagság.'; end if;

  select user_id into v_owner from public.players where id = p_player_id and game_id = v_current;
  -- Az ismételt kilépés hatástalan. Egy újracsatlakozás új játékosazonosítót
  -- kap, így a korábbi tagsághoz tartozó késői kérés sem törölheti azt.
  if not found then return; end if;
  if v_owner is distinct from v_user then raise exception 'Csak a saját lobbytagságodat szüntetheted meg.'; end if;

  -- Lobbyban még nincs kiosztott lap, kör vagy játékosra mutató játékállapot.
  -- Nincs CASCADE: egy esetleges történeti hivatkozás is megakadályozná a törlést.
  delete from public.players where id = p_player_id and game_id = v_current and user_id = v_user;
  if found then perform private.touch_room(); end if;
end;
$$;

create function public.reset_lobby(p_game_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := private.require_user(); v_current uuid; v_new uuid;
begin
  -- Az indítás, csatlakozás, kilépés és megszakítás is ugyanezt a zárat használja.
  select current_game_id into v_current from public.room_state where id = 1 for update;
  if not exists (select 1 from public.players where game_id = p_game_id and user_id = v_user) then
    raise exception 'Csak a lobby résztvevője hozhat létre új lobbyt.';
  end if;
  if v_current is distinct from p_game_id then
    -- A régi névsor megmarad az ismételt/párhuzamos kérés azonosításához.
    -- Az ismétlés későbbi lobbyt vagy már elindult partit sem nullázhat.
    select id into v_new from public.games where reset_from_game_id = p_game_id;
    if found then return v_new; end if;
    raise exception 'Már másik lobby van az asztalon.';
  end if;
  if (select status from public.games where id = v_current) <> 'lobby' then
    raise exception 'Új lobbyt csak lobby állapotban hozhatsz létre. A játék már elindult.';
  end if;

  insert into public.games (reset_from_game_id) values (p_game_id) returning id into v_new;
  -- Senkit nem másolunk át. A pillanatkép mindenkinél me_id = null értéket ad.
  update public.room_state set current_game_id = v_new where id = 1;
  perform private.touch_room();
  return v_new;
end;
$$;

revoke all on function public.leave_lobby(uuid, uuid), public.reset_lobby(uuid) from public, anon, authenticated;
grant execute on function public.leave_lobby(uuid, uuid), public.reset_lobby(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;

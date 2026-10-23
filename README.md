# Szar ügy.

Mobilra készült, magyar nyelvű, valós idejű társas kártyajáték. A három kezdőlapot mindenki magának pontozza; később a többi játékos titkos értékeléseinek átlaga alapján kell az új lapot a saját sorba illeszteni. Az első 10 lapos játékos nyer.

**Teljes alkalmazás, nem demó:** Next.js App Router + React + TypeScript + Tailwind CSS; Supabase PostgreSQL, Anonymous Authentication és Realtime. Nincs külön Node-szerver, service role kulcs a frontendben vagy kliensoldali eredményeldöntés. A Vercel csak a Next.js alkalmazást szolgálja ki; a tranzakciós játéklogika Supabase RPC-kben fut.

## Gyors indulás

Szükséges: **Node.js 22.13+ (22 LTS ajánlott)**, npm, egy Supabase-projekt. A `.nvmrc` a 22-es ágat választja. A régebbi Node 20 nem támogatott az aktuális Supabase SDK-val.

```sh
npm install
```

Másold a `.env.example` fájlt `.env.local` néven, majd töltsd ki a két publikus változót. PowerShell:

```powershell
Copy-Item .env.example .env.local
```

macOS/Linux:

```sh
cp .env.example .env.local
```

Ezután állítsd be az alábbi Supabase-lépéseket, majd:

```sh
npm run dev
```

Az alkalmazás: **http://localhost:3000**. Kulcsok nélkül is elindul, de beállítási képernyőt mutat, nem színlel működő játékot.

## 1. Supabase-projekt

1. Hozz létre egy projektet a [Supabase Dashboardban](https://supabase.com/dashboard), lehetőleg a játékosokhoz közeli régióban.
2. **Project Settings → API / API Keys** alatt másold ki a projekt URL-jét és a **publishable** vagy a régebbi **anon** kulcsot. Ne a secret/service role kulcsot használd a frontendben.
3. **Authentication → Sign In / Providers → Anonymous Sign-Ins**: engedélyezd a névtelen belépést. A Dashboard menüpontjainak neve verziótól függően eltérhet.
4. **Authentication → URL Configuration**: helyben a Site URL `http://localhost:3000`, telepítés után a végleges HTTPS Vercel-domain legyen. Ez a játék nem használ emailes belépést, OAuth-t vagy redirect callbacket.
5. **Authentication → Rate Limits**: az azonos Wi-Fi-ről érkező társaságnak elegendő névtelen belépést engedj. A Supabase alapértelmezett anonim korlátja IP-alapú; sok inkognitóteszt gyorsan elérheti. Éles, nyilvános használatnál gondoskodj a visszaélésvédelemről. CAPTCHA bekapcsolása esetén külön CAPTCHA-integráció kellene; a jelenlegi, baráti használatra készült belépő nem küld CAPTCHA-tokent.

Nem kell manuálisan Auth-felhasználókat létrehoznod. A kliens névtelen munkamenetet hoz létre és a Supabase SDK tartósan megőrzi azt.

## 2. SQL-migráció

### Dashboardból, CLI nélkül

Új, üres adatbázisnál nyisd meg a **SQL Editor** felületet, és futtasd a teljes fájlokat adminisztrátori / `postgres` szerepkörben, egyszer, ebben a sorrendben:

```text
supabase/migrations/202610200001_game.sql
supabase/migrations/202610230001_cancel_game.sql
```

Az első migráció hozza létre az összes táblát, indexet, megszorítást, RLS-t, RPC-t, az első üres lobbit és a Realtime publikációhoz tartozó beállítást. Üres projektre készült, nem többször futtatandó seed. Hibánál ne csak a kijelölt fél fájlt futtasd.

**Már működő, adatokat tartalmazó adatbázisnál kizárólag az új `202610230001_cancel_game.sql` migrációt futtasd**, az új frontend telepítése előtt. Ez egy tranzakcióban bővíti az `end_reason` CHECK constraintet a `cancelled` értékkel, hozzáadja a megszakítás metaadatait és a jogosultságellenőrzött `cancel_game` RPC-t, illetve frissíti az állapotlekérést. Nem töröl játékot, játékost, kártyát, kört, értékelést vagy eseményt; nem kell újra seedelni, és nem kell `db reset`. A korábbi migráció változatlan marad.

### Supabase CLI-vel

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

A `supabase/config.toml` a Dockerrel futó helyi Supabase-hoz is tartalmaz konfigurációt:

```sh
npx supabase start
npx supabase db reset
```

A helyi indítás által kiírt API URL-t és anon kulcsot használd a `.env.local` fájlban. A mintaeseményeket ezután külön importáld. A `db reset` kizárólag eldobható helyi adatbázison használható; meglévő éles adatbázis törlése nem szükséges a telepítéshez.

## 3. Realtime

A migráció a **`public.room_state`** táblát hozzáadja a Supabase `supabase_realtime` publikációjához. A Dashboard **Database → Publications / Replication** felületén ellenőrizd, hogy ez be van kapcsolva.

**Csak a `room_state` táblát kell publikálni. Ne adj olvasási jogot a `ratings`, `rounds` vagy más játéktáblákra.** A jelzés négy titokmentes mezőből áll: szobaazonosító, jelenlegi játékazonosító, revízió, időbélyeg. A kliens minden jelzés után jogosultságszűrt állapotot kér RPC-vel.

Nem szükséges Broadcast/Presence-csatorna, Edge Function, webhook, cron vagy Vercel WebSocket-szerver. Megszakadás, lap-visszanyitás, fókusz és tokenfrissítés után új állapotlekérés történik; 12 másodperces biztonsági visszaolvasás is van. Normál esetben azonnal a Realtime indítja a frissítést.

## 4. Események feltöltése

A **`data/events.hu.json` 60 saját, magyar nyelvű, előre nem pontozott eseményt** tartalmaz, nem az eredeti társasjáték kártyaszövegeit.

### A) SQL Editorral, service role kulcs nélkül

```sh
npm run events:sql
```

Nyisd meg a létrejött **`supabase/seed.sql`** fájlt, és futtasd a SQL Editorban. A generátor UTF-8 fájlt ír, így PowerShellben sem lesz hibás az ékezetek kódolása. Azonos címnél frissít, nem hoz létre duplikátumot.

### B) Importáló szkripttel

A `.env.local` fájlba **kizárólag a helyi import idejére** add meg:

```dotenv
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_OR_SERVER_SECRET_KEY
```

```sh
npm run events:import
```

A szkript a publikus URL-t és ezt a szerveroldali adminisztrátori kulcsot használja az események upsertjéhez. A kulcs soha ne kapjon `NEXT_PUBLIC_` előtagot, ne kerüljön Gitbe vagy a Vercel frontend-változói közé. Import után eltávolíthatod. Az alkalmazásnak nincs rá szüksége.

Más JSON-fájlból:

```sh
npm run events:import -- data/sajat-esemenyek.json
npm run events:sql -- data/sajat-esemenyek.json
```

A JSON formátuma:

```json
[
  {
    "title": "Egy saját esemény címe",
    "description": "Rövid, magyar nyelvű leírás.",
    "active": true
  }
]
```

### Mennyi esemény szükséges?

Induláskor **9 × játékosok száma + 1** aktív esemény kell. Így akkor is van még egy szabad lap, amikor mindenki 9 lapon áll. Hat játékoshoz 55 szükséges, a 60-as készlet elég; hét játékoshoz már 64 kell. Nincs hatfős kényszer vagy mesterséges létszámkorlát, de legalább ketten kell játszani.

A megszerzett esemény az adott partiban foglalt; a hibásan elhelyezett rögtön újra húzható, és **új pontozást kap**. Ha menet közben az adatbázisban eseményeket deaktiválsz és elfogy a pakli, a parti érthető üzenettel, győztes nélkül lezárul. Nem marad hibás aktív körben.

## 5. Környezeti változók

| Név | Hol szükséges? | Jelentés |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | helyben, Vercelen | Supabase projekt API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | helyben, Vercelen | publishable vagy anon kulcs; RLS védi a hozzáférést |
| `SUPABASE_SERVICE_ROLE_KEY` | opcionális helyi import | adminisztrátori kulcs; nem a webalkalmazás része |
| `ALLOW_LIVE_GAME_TEST` | opcionális helyi élő teszt | `1` engedélyezi a külön tesztprojektben futó szimulált partit |

A `NEXT_PUBLIC_*` értékek buildidőben épülnek a klienscsomagba. Változtatásuk után helyben szerver-újraindítás, Vercelen új deployment kell.

## 6. Lokális használat és telefonok

```sh
npm run dev
```

A szerver `0.0.0.0:3000` címen figyel. Azonos Wi-Fi-n a telefonokon a gép LAN-címét nyisd meg, pl. `http://192.168.1.20:3000`. Ha a Windows tűzfal kérdezi, a magánhálózaton engedélyezd a Node elérését. A Supabase ehhez a felhőben futhat; helyi Supabase esetén a projekt URL-jében is telefonról elérhető LAN-cím kell, nem `127.0.0.1`.

Minden játékosnak külön böngészőprofil vagy külön telefon kell. Ugyanannak a böngészőprofilnak két lapja **ugyanaz a játékos**. Újratöltés, rövid kapcsolatvesztés vagy a telefon képernyőjének lezárása nem törli a lapokat. Ne töröld a webhelyadatokat, és ne válts inkognitóból normál módra: a névtelen Auth-azonosító elvesztésével a régi játékos nem állítható vissza pusztán a becenévvel.

### Folyamatban lévő parti megszakítása

A kezdőkártyák értékelése, a normál kör és a többiekre várakozás közben minden résztvevő látja a diszkrét, legalább 44 px magas **Játék megszakítása** gombot. A megerősítő ablakban a **Mégse** vagy az Escape semmit nem változtat; a piros **Játék megszakítása** archiválja a partit, és minden résztvevőt automatikusan ugyanabba az új, üres lobbyba visz, a becenevek és Auth-munkamenetek megtartásával. A lobby rövid üzenetben megnevezi a kezdeményezőt.

Innen bárki indíthat új partit, fejenként három új, még nem pontozott kezdőlappal. A régi lapok, pontszámok, elhelyezések és köreredmények nem kerülnek át. A normál győzelem vagy paklielfogyás utáni újracsatlakozási folyamat változatlan.

## 7. Vercel telepítés

1. Tedd a projektet egy saját Git-repositoryba, és importáld a [Vercelen](https://vercel.com/new), vagy a Vercel CLI-vel ebből a könyvtárból telepíts.
2. Framework: **Next.js**; Root Directory: a projekt gyökere.
3. Node.js: **22.x** (vagy újabb támogatott LTS). Install: `npm ci`; Build: `npm run build`; Output Directory: a Next.js alapértelmezettje, ne állíts át statikus exportra.
4. Add hozzá a **két** `NEXT_PUBLIC_SUPABASE_*` változót a kívánt Production/Preview környezethez. Service role kulcs nem kell a Vercelre.
5. Deploy. A Supabase migrációt és a mintaadat-importot előtte külön el kell végezni; a Vercel build nem módosít adatbázist.
6. A Supabase Site URL-jét állítsd a végleges `https://...vercel.app` vagy saját domainre.
7. Minden telefonon ugyanazt a végleges címet nyissátok meg.

Nem kell Vercel-adatbázis, háttérben futó szerver vagy időzített feladat. A Preview és Production ugyanabba a szobába kerül, ha ugyanazt a Supabase-projektet használják; **teszteléshez külön Supabase-projekt ajánlott**. Az azonosító böngésző-originhez kötött, tehát a preview-domainről másik domainre váltva nem ugyanaz a helyi munkamenet lesz.

## 8. Ellenőrzések

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

### Automatikus adatbázistesztek

A Vitest a **tényleges SQL-migrációkat, sorrendben** tölti be a PGlite PostgreSQL 17 motorjába. A Supabase Auth `auth.uid()` függvényének és szerepköreinek minimális tesztkörnyezete helyi, a játéklogika nem mock vagy külön TypeScript-másolat. Docker és külső kulcs nélkül fut.

Lefedettség: pontos átlag és félérték-kerekítés; helyes/hibás elhelyezés és egyező pontok; kezdőkártyák egyedisége és véglegessége; lobbyzár; szerepkörök és nyers hozzáférés tiltása; titkos átlag; ismételt indítás/pontozás/véglegesítés; fix körsorrend; visszaolvasás; hibás lap újrahúzása új pontozással; teljes hatfős parti a 10. lapig; paklielfogyás; ismételt újraindítás és megőrzött előzmények.

A megszakítás tesztjei ellenőrzik a közös lobbyt és a megőrzött neveket, a kezdőpontozást és várakozást, az aktív játékos és a pontozó jogosultságát, a kívülállók kizárását, az ismételt/párhuzamos kéréseket, a tiszta háromlapos új partit, a késő régi kérések elutasítását, a hibánál teljes tranzakció-visszagördítést és a már adatokat tartalmazó régi sémára alkalmazott új migrációt.

A PGlite egy adatbázis-kapcsolatot sorosít: az idempotenciát és a SQL-logikát ellenőrzi, **nem helyettesíti a külön PostgreSQL-kapcsolatok valós zárversenyét vagy a Supabase Realtime szerverét**.

### Mobilböngészős végponttól végpontig teszt

```sh
npx playwright install chromium
npm run test:browser
```

Két külön, mobilméretű Chromium-profilban ellenőrzi a lobby frissülését, a csúszkát, a kezdőpontozást, a gombok feltételeit, a pozíció megőrzését újratöltéskor, az eredmény felfedését, az offline visszatérést, a későn érkezők kizárását, a kilenclapos kártyasor tíz választható helyét, a győzelmi képernyőt és az új partit. A játékmotor itt is a valódi SQL-migráció PGlite-on; **csak az Auth/HTTP/WebSocket szállítás tesztadapteres**, nem éles Supabase. A teszt automatikusan külön Next.js szervert indít a 3100-as porton, tesztkörnyezeti változókkal. A `test-results/` mappába mobil- és asztali képernyőképeket ír.

A külön megszakítási böngészőteszt 320 px széles telefonokon ellenőrzi a megerősítő ablakot, a fókuszt és az Escape/Mégse működését, a kezdőpontozás és a normál kör megszakítását, a másik eszköz automatikus lobbyváltását (akkor is, ha ott is nyitva van az ablak), a megőrzött neveket, az új kezdőlapokat és a két egyszerre elküldött megszakítást.

### Opcionális élő, hatklienses Supabase-teszt

Külön, üres lobbyval rendelkező **tesztprojekten**, betöltött 60 eseménnyel:

```dotenv
ALLOW_LIVE_GAME_TEST=1
```

```sh
npm run test:live
```

Ez hat valódi névtelen felhasználót és hat Realtime-feliratkozást indít. Párhuzamos HTTP-kérésekkel indít, duplán pontoz és véglegesít, ellenőrzi a titokmentes Realtime-adatot, a nyers értékelések tiltását, végigjátszik egy 37 körös partit és ellenőrzi a visszatérést ugyanazzal a tokennel. Nem használ service role-t, nem töröl adatot és nem csatlakozik már foglalt lobbyhoz. A teszt lezárt partit és Auth-tesztfelhasználókat hagy maga után; csak eldobható tesztprojektben futtasd.

### Kézi telefonos próba

- Két–hat külön telefon/profil: csatlakozás után mindenkinél rögtön frissül a lobby.
- Két játékos egyszerre indít: mindenki ugyanazt az egy partit látja.
- Mindenki egyenként pontozza a három kezdőlapot; a kész játékosok a többiekre várnak.
- Az aktív játékos már pontozás közben helyet választ, a véglegesítés az utolsó értékelésig tiltott.
- Körzárás előtt a böngésző hálózati válaszában sincs más értékelése vagy átlag.
- Véglegesítés után mindenkinél ott a teljes név/pontszám táblázat és már fut a következő kör. Az eredménypanel összecsukható, nem kér közös jóváhagyást.
- Próbálj szándékosan rossz helyet, pontazonosságot, frissítést és repülő módot.
- Kezdőpontozáskor, kész kezdőlapokkal várakozva, aktív játékosként és beküldött pontszámmal is próbáld a megszakítást; Mégse után ne változzon semmi.
- Megerősített megszakításkor minden telefon automatikusan ugyanabba a lobbyba kerüljön, megőrzött nevekkel és a kezdeményezőt megnevező üzenettel. A másik játékos indítson új partit: újra három pontozatlan kezdőlapot kapjon mindenki.
- Két telefonról egyszerre erősítsétek meg a megszakítást: csak egy új lobby jöhet létre.
- A 10. lap lezárja a játékot; az új várót megnyitó bent van, a többiek újra csatlakoznak.

**Telepítési korlát:** Supabase- és Vercel-hozzáférés nélkül az éles telepítést és a telefonok közötti külső Realtime-kapcsolatot nem lehet igazolni. A projekt nem állítja, hogy ezek konfiguráció nélkül már létrejöttek.

## 9. Biztonsági és működési döntések

- **Egy közös szoba**, host és szobakód nélkül. Bármelyik résztvevő indíthat; utána a lista rögzített.
- A `room_state` sor **`FOR UPDATE` zárja** minden módosító RPC első adatbázislépése. A kör lezárása, a lap jóváírása, a győztes és a következő kör létrehozása ugyanabban a tranzakcióban történik. Egyedi részindexből is csak egy nyitott kör lehet partinként.
- A kérések hordozzák a játék-, kör- vagy lapazonosítót. Régi kérés nem módosíthat új partit/kört. Dupla azonos pontozás és körzárás hatástalan; már rögzített pontszám megváltoztatása hiba.
- Minden tábla **RLS-es**; az `anon` és `authenticated` nem kap közvetlen játéktábla-jogot. Csak a titokmentes `room_state` olvasható. Az állapotot a `get_game_state()` szűri `auth.uid()` alapján.
- A módosító RPC-k `SECURITY DEFINER`, üres `search_path` mellett, teljesen minősített táblanevekkel futnak. A privát segédek nem hívhatók a kliensből. Mindenkinek csak a szükséges publikus RPC-khez van végrehajtási joga.
- A nyitott kör átlagát az adatbázis már az utolsó értékeléskor kiszámolja, de **sem a snapshot, sem a Realtime nem küldi el**. A pontozó a saját már beadott pontját visszakapja, másét csak lezárás után. Az aktív játékos a saját körében nem pontozhat.
- Pontszámok **egész tizedpontok**: `67,4 = 674`. Az átlag PostgreSQL `numeric` művelettel kerekül, nem lebegőpontos számmal. A széleken és azonos pontoknál a szomszédos `≤` feltételek érvényesek.
- A kezdőpontozás végén az utolsó értékelést mentő tranzakció kezdi az első kört. Körzáráskor azonnal elindul a következő; az előző eredmény külön panelben marad a következő lezárásig, újratöltés után is. A történeti értékelések megmaradnak az adatbázisban.
- Nincs automatikus játékostörlés, automatikus partiindítás vagy távolléti időkorlát. Egy hosszabban eltűnő résztvevőre vár a társaság; ezt szándékosan nem helyettesíti bot, automatikus pontozás vagy kihagyás. Szükség esetén bármely résztvevő megszakíthatja a partit.
- Győzelem vagy paklielfogyás után a kézzel megnyitott friss lobby csak a kezdeményezőt tartalmazza; a többiek újra csatlakoznak. **Megszakításkor viszont minden résztvevőt automatikusan átmásolunk**, azonos Auth-felhasználóval, becenévvel és sorrenddel, de új, partihoz kötött játékosazonosítóval. Mindkét esetben megmarad minden korábbi játék, lap, kör, pontozás és az eseménygyűjtemény.
- A `cancel_game` a többi RPC-vel közös `room_state` sorzár alatt, egy tranzakcióban archivál és vált lobbyt. A `games.cancelled_from_game_id` egyedi hivatkozása és a már megszakított kérés hatástalan ismétlése kizárja a dupla lobbyt; régi játékazonosítók nem írhatnak az új partiba. A Realtime-változásjelző továbbra sem tartalmaz becenevet vagy más játékadatot.
- A névtelen Auth-felhasználókat játék közben ne töröld vagy takarítsd automatikusan; a történeti `players` sorok hivatkoznak rájuk. A kulcs és a kliensoldali becenévtipp nem helyettesíti az Auth-munkamenetet.
- Nincs adminfelület. Eseményt a Dashboard Table Editorban vagy importtal szerkeszthetsz; a már hivatkozott eseményeket törlés helyett `active = false` értékkel kapcsold ki. A mintafájl újraimportja az abban szereplő címeket és aktív állapotukat is frissíti.

## 10. Fájlok

```text
app/                         Next.js oldalak, magyar metaadatok, globális stílus
components/                  lobby, pontozás, kártyasor, köreredmény, végeredmény
lib/game/                    RPC-hívások, állapottípusok, Realtime és visszacsatlakozás
lib/supabase/                tartós névtelen kliens, szűk RPC-típusok, hálózati időkorlát
supabase/migrations/         futtatható adatmodell, RLS, tranzakciós játékmotor
supabase/config.toml         opcionális helyi Supabase
data/events.hu.json          60 eredeti magyar esemény
scripts/import-events.mjs    JSON-import vagy SQL-generálás
scripts/smoke-supabase.ts     opcionális valódi hatklienses integrációs teszt
tests/                       SQL-alapú játékmenet- és jogosultságtesztek
tests/browser/               mobil Chromium + valódi SQL, teszt hálózati adapterrel
.env.example                 kitöltendő környezeti változók
```

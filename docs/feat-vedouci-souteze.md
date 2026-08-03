# FEAT: Režim „Vedoucí soutěže“ (celý ročník z XML)

## Kontext

pgn-base má dvě úrovně kontejnerů: **sezóna** (pohled klubového hráče — moje
družstvo napříč koly) a **kolo** (pohled vedoucího soutěže — jedno kolo, všechny
zápasy, `docs/feat-round-view.md`). Tady jdeme **o úroveň výš**: celý ročník
jedné soutěže, tedy všechna kola × všechny zápasy × všechny šachovnice.

Rozdíl proti pgn-base není jen v rozsahu. pgn-base staví kostru z **api.chess.cz**
(kolo po kole, jen odehrané zápasy). Vedoucí soutěže má ale k dispozici **XML
soutěže**, které mu leží v adresáři Swiss-Manageru — a to je úplná kostra celého
ročníku včetně rozlosování dosud neodehraných kol, soupisek a kontumací.

Typický životní cyklus:

1. **Začátek sezóny** — vedoucí založí soutěž z XML. Vznikne kompletní kostra
   (11 kol × 6 zápasů × 8 šachovnic = 528 partií) s hlavičkami, ale bez tahů.
2. **Po každém kole** — Swiss-Manager XML přepíše o výsledky kola. Vedoucí udělá
   **re-sync**: doplní se sestavy, výsledky a kontumace. Tahy, které už dorazily,
   se nikdy nepřepíšou.
3. **Průběžně** — kapitáni posílají tahy. Vedoucí je nahrává buď po zápasech
   (8 partií najednou), nebo po jednotlivých partiích.
4. **Kontrola** na libovolné úrovni stromu (partie / zápas / kolo / soutěž).
5. **Export** — bulletin kola nebo celý ročník, ve formátu ŠSČR.

## Podkladová data — co bylo ověřeno

Validováno proti souborům, které dodal vedoucí soutěže KS A StčŠS 2025/26:
`3005_09.XML`, `3005_full.XML`, `KSA_SSS_25_26_SM.pgn` (PGN vygenerovaný
Swiss-Managerem), `KSA_SSS_25_26.pgn` (PGN vedoucího soutěže, tj. cílový formát).

**Pozor: oba XML soubory jsou obsahově identické** — liší se jen v `<info><id>`
(3005 vs 3318). Oba mají vyplněná kola 1–9 a prázdná kola 10–11. „Plný“ soubor
tedy plný není; použitelný rozdíl mezi stavy sezóny z nich nevyčteme. PGN od
Swiss-Manageru je naopak už z pozdějšího stavu (kola 1–11 s výsledky).

### Dokumentace XML formátu

**Veřejná dokumentace k tomuto formátu neexistuje.** Oficiální
[Swiss-Manager XML-Import](https://swiss-manager.at/unload/XML_import_SwissManager.pdf)
(Heinz Herzog, 18. 9. 2024) popisuje **jiné** schéma — `<Teams>`, `<Players>`,
`<TeamCompositions>`, `<Results>` s atributy. To, co Swiss-Manager ukládá do
svého adresáře, je proprietární `<chess><tournament name="basic">` s elementy.
Jediná návaznost na dokumentaci je dvojice `scr`/`sct`, která odpovídá
dokumentovanému `Res`/`ResRtg` (výsledek vs. výsledek pro výpočet ELO).

Schéma níže je proto **reverzně odvozené a ověřené** diffem proti PGN, které
Swiss-Manager sám vygeneroval z týchž dat (viz „Ověření“).

### Schéma

```xml
<chess>
 <tournament name="basic">
  <info>…</info>            <!-- 1× -->
  <team>…</team>            <!-- 1× na družstvo -->
  <round>…</round>          <!-- 1× na kolo -->
  <list>…</list>            <!-- 1× na hráče na soupisce -->
  <game>…</game>            <!-- 1× na šachovnici (kolo × zápas × šachovnice) -->
  <results>…</results>      <!-- 1× na zápas -->
 </tournament>
</chess>
```

| Element   | Pole                                 | Význam                                                                                    |
| --------- | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `info`    | `id`                                 | interní ID soutěže ve Swiss-Manageru (**ne** `compId` z api.chess.cz)                     |
|           | `name`                               | plný název soutěže → tag `Event` v interním formátu                                       |
|           | `teams`, `players`                   | počet družstev / **počet šachovnic v zápase** (ne počet hráčů!)                           |
|           | `year`                               | úvodní rok ročníku (2025 = 2025/26)                                                       |
|           | `wins`, `lost`, `remi`               | bodování zápasu; v datech 3 / 1 / 0 — pořadí polí neodpovídá názvům, nespoléhat           |
|           | `www`                                | odkaz na chess-results                                                                    |
| `team`    | `no`, `name`                         | číslo (1…N) a plný název družstva                                                         |
|           | `man1`/`m1`…                         | kontakty na kapitány (v datech prázdné)                                                   |
| `round`   | `no`, `term`                         | číslo kola, datum `YYYY-MM-DD`                                                            |
|           | `schedule`                           | rozlosování, viz níže                                                                     |
| `list`    | `tno`, `desk`                        | číslo družstva + **pořadí na soupisce** (1…N, souvislé)                                   |
|           | `code`, `name`                       | ID hráče v ŠSČR, jméno jako `Příjmení Jméno`                                              |
|           | `cr`, `fide`                         | národní / FIDE ELO — **snímek k začátku sezóny**                                          |
|           | `memo`                               | příznaky soupisky (`Z`, `H`, `K`, `ZK`, `V`, kombinace čárkou)                            |
| `game`    | `no`, `rid`                          | číslo kola + token rozlosování (klíč do `schedule`)                                       |
|           | `pde1`, `pde2`                       | `desk` nasazeného hráče domácích / hostů; **0 = nikdo nenastoupil**                       |
|           | `scr1`, `scr2`                       | výsledek: `1`/`0`/`0.5`, se sufixem `F` u kontumace; `0`/`0` = neodehráno                 |
|           | `sct1`, `sct2`                       | výsledek pro ELO (jen když se liší od `scr`) — partie se odehrála, ale bod jde kontumačně |
| `results` | `no`, `tno1`, `tno2`, `scr1`, `scr2` | skóre zápasu; ověřeno, že se rovná součtu `game.scr`                                      |

**`schedule`** je řetězec pevné šířky: 4 znaky na zápas, `%2d` domácí + `%2d`
hosté, tedy `" 112 211 310 4 9 5 8 6 7"` = 6 zápasů `1-12, 2-11, 3-10, 4-9, 5-8,
6-7`. **Pořadí tokenů určuje číslo zápasu v kole** (1…6) — a to je pořadí, které
používá i Swiss-Manager ve svém PGN.

**`rid`** je doslovný 4znakový token ze `schedule` (včetně mezer). Slouží jako
klíč: `game` elementy se stejným `(no, rid)` tvoří jeden zápas a **jejich pořadí
v dokumentu je pořadí šachovnic** (1…8).

### Odvozená pravidla

- **Barvy**: na liché šachovnici má bílé domácí družstvo (`tno1`), na sudé hosté.
  Ověřeno na 514/514 partiích.
- **Výsledek** `scr1`/`scr2` je z pohledu **domácích**, ne bílého — na sudých
  šachovnicích se musí otočit.
- **Kontumace**: `F` v `scr`. Pokud navíc `pde` = 0, hráč vůbec nenastoupil.
  Když je `sct` vyplněné, partie se odehrála, ale bod se přiděluje kontumačně.
- **Jméno** `Příjmení Jméno`: první token je příjmení, **kromě** následujícího
  `st.`/`ml.`, které k příjmení patří (`Aulický st. Radim` → `Aulický st., Radim`).
  Zbytek je celé křestní pole (`Nguyen Minh Khang Tomáš` → `Nguyen, Minh Khang Tomáš`).
  Obojí ověřeno proti PGN Swiss-Manageru.

### Ověření

Kostra odvozená z XML se porovnala s PGN, které Swiss-Manager vyexportoval
z týchž dat (`KSA_SSS_25_26_SM.pgn`, `Round` = `kolo.zápas.šachovnice`):

| Pole                      | Shoda   | Poznámka                                                                                    |
| ------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| `Date`                    | 514/514 | —                                                                                           |
| `WhiteTeam` / `BlackTeam` | 514/514 | potvrzuje pořadí zápasů i paritu barev                                                      |
| `White` / `Black`         | 421/422 | zbytek jsou kola 10–11, která XML nemá; 1 rozdíl = `Aulický st.` (opraveno pravidlem výše)  |
| `Result`                  | 422/422 | zbytek jsou kola 10–11                                                                      |
| `WhiteElo`/`BlackElo`     | ~12 %   | **XML nese snímek ELO k začátku sezóny**, Swiss-Manager exportuje FIDE ELO aktuální ke kolu |

**XML je bohatší kostra než PGN Swiss-Manageru**: SM vynechává kontumované
šachovnice úplně (514 z 528 partií), XML je má všechny. Proto je kostra ze XML,
ne z PGN.

### Cílový formát (PGN vedoucího soutěže)

`KSA_SSS_25_26.pgn` ukazuje, co má vypadnout z exportu:

```
[Event "KSA SSS 25/26 Sedlcany-Kralupy B"]   ← zkratka soutěže + zkrácená družstva, bez diakritiky
[Date "2025.10.12"]
[Round "1.1"]                                 ← kolo.šachovnice (zápas je v Event)
[White "Simak, Roman"]
[Black "Hanl, Frantisek"]
[Result "1/2-1/2"]
[ECO "B36"]
[WhiteElo "1896"]
[BlackElo "2158"]
[PlyCount "73"]
```

Analýza jeho 518 partií zároveň ukazuje, **proč to celé stavíme** — ručně
udržovaný soubor obsahuje:

- `KSA SSS **24/25**, Revnice - Bustehrad A` — špatný ročník v `Event`
- `Date "**2026**.11.30"` a `Date "**2025**.01.11"` — překlepy v roce
- jeden `Event` (`Hostivice-Sedlcany`) s partiemi označenými `Round` 10 i 11
- tři různé oddělovače za zkratkou soutěže (` `, `, `, `,`)
- devět různých zápisů týchž družstev (`Kralupy B` / `Klokani z Kralup` /
  `Kralupy`, `Brodce B` / `JAWA Brodce B` / `BrodceB`, `Neratovic` …)
- 10 chybějících partií (kontumace)

Kostra z XML je proti tomu deterministická: `Event`, `Date`, `Round`, jména
i výsledky se generují, nepíšou.

## Datový model

### Jedna soutěž = jeden PGN + manifest

```
<dokumenty>/
  KSA_2025_26.pgn                 ← 528 partií, plný formát, jediný zdroj pravdy
  KSA_2025_26.info                ← stávající sidecar en-croissant ({type:"tournament"})
  KSA_2025_26.competition.json    ← manifest soutěže (nový)
  KSA_2025_26.xml-archiv/         ← kopie importovaných XML (audit + rollback)
```

**Proč jeden soubor a ne 66** (pgn-base má DB na zápas): pgn-base má relační
databázi, kde je kontejner přirozený. Tady je kontejnerem souborový systém a
adresář se 66 soubory je horší v každém ohledu, který nás zajímá — hlavičkové
operace napříč kolem/soutěží by musely otevírat desítky souborů, re-sync by
psal do desítek souborů netransakčně a export ročníku by je zase slepoval.
Celý ročník s tahy má ~400 kB; načtení a přepis jednoho souboru je levné.
Stávající nástroje (Kontrola, Export, Import tahů) navíc už dnes pracují nad
**všemi partiemi jednoho souboru**, takže se do nich strom vejde jako filtr.

### Identita partie = `Round`

Tag **`Round` = `kolo.zápas.šachovnice`** (konvence Swiss-Manageru) je primární
klíč. Slouží zároveň jako:

- spojovací klíč pro re-sync z XML,
- klíč pro párování tahů od kapitánů,
- struktura stromu v GUI,
- vstup pro export (`kolo.šachovnice` + zápas přesunutý do `Event`).

Žádný další identifikátor tedy není potřeba — kostra je samopopisná a soubor
zůstává obyčejné PGN, které otevře cokoli.

### Interní (plný) formát partie

```
[Event "Krajská soutěž SŠS 2025/26 - skupina A"]   ← plný název z <info><name>
[Site ""]                                           ← místo konání domácích (z adresáře zkratek)
[Date "2025.10.12"]
[Round "1.1.1"]
[White "Šimák, Roman"]
[Black "Hánl, František"]
[Result "1/2-1/2"]
[WhiteTeam "ŠK KDJS Sedlčany A"]
[BlackTeam "Klokani z Kralup"]
[WhiteElo "1889"]          ← <fide> (volitelně <cr>), snímek ze soupisky
[BlackElo "2160"]
[WhiteCzeId "342"]         ← <code>
[BlackCzeId "910"]
[Board "1"]
[EventDate "2025.10.12"]
[Termination "forfeit"]    ← jen u kontumace
[RatedResult "1/2-1/2"]    ← jen když se <sct> liší od <scr> (odehráno, ale bod kontumačně)
[ECO …] [PlyCount …]       ← dopočítá stávající „Přepočet“, až dorazí tahy
```

Diakritika se **drží** (en-croissant je plně UTF-8); shazuje se až v exportu.
XML nenese FIDE ID, takže `WhiteFideId` neumíme — jen `WhiteCzeId`. Doplnění
FIDE ID z api.chess.cz je možné později, klient už v repu je.

### Manifest (`*.competition.json`)

Drží to, co není per-partie a co by se z PGN nedalo spolehlivě rekonstruovat:

- zdroj: cesta k XML, hash, čas posledního importu, `<info><id>`,
- soutěž: plný název, ročník, počet šachovnic, `compId` z api.chess.cz (pokud
  ho vedoucí zadá — odemyká zkratky a doplňování hráčů),
- družstva: `no → { name, label, site }` — adresář zkratek pro export
  (viz `feat-team-name-shortening.md` v pgn-base; `teamShorten.ts` už v repu je),
- kola: číslo → datum + pořadí zápasů,
- předvolby exportu.

## Rozdělení práce

| Část                    | Obsah                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Datová vrstva**    | `src/utils/sscr/`: parser XML, dělení jmen, generátor kostry, schéma manifestu. Čisté funkce + vitest nad reálnými daty.                                        |
| **2. Import + re-sync** | Dialog „Nová soutěž z XML“, `syncFromXml` s diff reportem a klasifikací konfliktů. Tahy se nikdy nepřepíšou.                                                    |
| **3. GUI stromu**       | Route + strom Soutěž → Kolo → Zápas → Partie, stav uzlů, hlavičkové operace / Kontrola / Import tahů se scopem na uzel.                                         |
| **4. Export ŠSČR**      | Exportní profil (2úrovňový `Round`, zkrácený `Event`, bez diakritiky, pořadí tagů dle referenčního souboru), editovatelný adresář zkratek, předletová kontrola. |

## Okrajové případy

- **XML neobsahuje kolo, které už proběhlo** (data ve Swiss-Manageru zaostávají) —
  re-sync nikdy nemaže; prázdné `pde`/`scr` znamenají „nevím“, ne „vymaž“.
- **Změna sestavy po vložení tahů** — konflikt se ukáže uživateli, nikdy se
  neřeší automaticky.
- **Kontumace s `sct`** — `Result` z `scr` (kontumační), `Termination "forfeit"`,
  a odehraný výsledek z `sct` do tagu `RatedResult`. Tag, ne komentář: až dorazí
  tahy od kapitána, movetext se přepíše a komentář by se ztratil.
- **Oboustranná kontumace** (`0F`:`0F`) — PGN takový výsledek neumí zapsat;
  `Result` zůstane `*` a rozhodnutí nese `Termination "forfeit"`.
- **`pde` = 0 na obou stranách** — kolo ještě nebylo losováno do sestav; partie
  vznikne se zástupnými jmény (`Domácí N` / `Hosté N`), stejně jako v pgn-base.
- **Dvě soutěže se stejným `<info><id>`** — id je lokální pro Swiss-Manager, na
  identitu souboru se nepoužívá; klíčem je cesta k PGN.

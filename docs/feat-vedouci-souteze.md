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
`3005_09.XML` (stav po 9. kole), `3005.XML` (celá sezóna),
`KSA_SSS_25_26_SM.pgn` (PGN vygenerovaný Swiss-Managerem),
`KSA_SSS_25_26.pgn` (PGN vedoucího soutěže, tj. cílový formát).

Ta dvojice XML je **jediný skutečný pár dvou stavů sezóny**, který máme, a proto
na ní stojí ověření re-syncu. Liší se přesně dvěma věcmi: kola 10 a 11 přešla
z vylosovaných-nulových na dohraná, a mezitím vyšla nová FIDE listina. (První
dodaná dvojice `3005_09.XML` / `3005_full.XML` použitelná nebyla — byla obsahově
identická, lišila se jen v `<info><id>`.)

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

Kostra odvozená z `3005.XML` se porovnala s PGN, které Swiss-Manager vyexportoval
z týchž dat (`KSA_SSS_25_26_SM.pgn`, `Round` = `kolo.zápas.šachovnice`).
Celá sezóna, všech 11 kol, **žádný rozdíl**:

| Pole                      | Shoda     | Poznámka                                      |
| ------------------------- | --------- | --------------------------------------------- |
| `Date`                    | 514/514   | —                                             |
| `WhiteTeam` / `BlackTeam` | 514/514   | potvrzuje pořadí zápasů i paritu barev        |
| `White` / `Black`         | 514/514   | včetně `Aulický st.` (pravidlo o příponách)   |
| `Result`                  | 514/514   | —                                             |
| `WhiteElo`/`BlackElo`     | 1009/1028 | 98 %, proti `3005_09.XML` jen 11 % — viz níže |

Elo je jediné pole, kde shoda závisí na tom, ze které generace XML kostru
stavíme: 98 % proti souběžnému exportu, 11 % proti staršímu. Roster tedy **je**
zdroj, kterým SM razítkuje partie — jen vždycky tím dnešním. Odtud pátá záruka
re-syncu.

**XML je bohatší kostra než PGN Swiss-Manageru**: SM vynechává kontumované
šachovnice úplně (514 z 528 partií), XML je má všechny. Proto je kostra ze XML,
ne z PGN.

### Cílový formát (PGN vedoucího soutěže)

`KSA_SSS_25_26.pgn` ukazuje, co má vypadnout z exportu:

```
[Event "KSA SSS 25/26 Sedlcany-Kralupy B"]   ← zkratka soutěže + zkrácená družstva, bez diakritiky
[Site "Sedlcany"]                             ← místo konání domácích (z adresáře družstev)
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
  KSA_2025_26/                    ← adresář soutěže: dovnitř patří všechno
    KSA_2025_26.pgn               ← 528 partií, plný formát, jediný zdroj pravdy
    KSA_2025_26.info              ← stávající sidecar en-croissant ({type:"tournament"})
    KSA_2025_26.competition.json  ← manifest soutěže (nový)
    KSA_2025_26.xml-archiv/       ← kopie importovaných XML (audit + rollback)
```

**Jedna soutěž = jeden adresář**: ve složce vedoucího přibude na sezónu jedna
položka, ne čtyři. Adresář zakládá import; **kód na něm nestojí** — všechny cesty
se odvozují z cesty `.pgn` (manifest je `<jméno>.competition.json` vedle něj, ne
`competition.json` v adresáři, aby se exportovaný bulletin uložený do téže složky
nikdy nespletl se soutěží). Proto soutěž funguje i mimo svůj adresář: ty založené
dřív běží dál tam, kde jsou, nic se nemigruje, a vedoucí smí složku v průzkumníku
přejmenovat nebo přesunout.

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

## Co je hotové

| Část                    | Kde                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Datová vrstva**    | `src/utils/sscr/{competitionXml,skeleton,manifest}.ts` + `utils/pgn/names.ts` — parser, dělení jmen, generátor kostry, schéma manifestu |
| **2. Import + re-sync** | `sync.ts` + `storage.ts` + `components/files/CompetitionDialogs.tsx`                                                                    |
| **3. GUI stromu**       | `tree.ts` + `components/files/CompetitionView.tsx`; nástroje berou `ToolScope`                                                          |
| **4. Export ŠSČR**      | `export.ts` + `directory.ts` + `components/files/SscrExportDialogs.tsx`                                                                 |

### Záruky re-syncu

Re-sync běží jednou za kolo po celou sezónu, takže na jeho zárukách záleží víc
než na chytrosti. Každou hlídá test:

1. **Tahy se nikdy neztratí.** Změna hlavičky u partie, která už nese tahy od
   kapitána, je _konflikt_, který vedoucí zaškrtne — a movetext přežije tak či tak.
2. **Regrese nikdy nepřepisuje.** Data ve Swiss-Manageru zaostávají; kolo, které
   v novém souboru přišlo o sestavu, znamená „nevím“, ne „vymaž“.
3. **Nic se nemaže.** Partie, které nové XML nepopisuje, zůstávají — označené, na
   konci souboru.
4. **`Event` a `Site` patří vedoucímu.** Jsou otisk importu a adresáře zkratek;
   totéž pravidlo, na kterém skončil pgn-base u „Načíst výsledky“.
5. **Elo je snímek, ne aktuální údaj.** Soupiska nese jednu Elo na hráče na celou
   sezónu — vždy tu dnešní listinu. Jakmile je partie odehraná, její Elo je
   historický fakt: re-sync ho doplní na prázdné šachovnici a víc už s ním nehne.

Pátá záruka vznikla až na reálné dvojici XML (viz níže) a je to jediné místo, kde
se záměrně rozcházíme se Swiss-Managerem. SM při každém exportu orazítkuje i
říjnové partie dnešní listinou — partie `1.1.1` má v `3005_09.XML` `BlackElo 2160`
a v `3005.XML` `2202`, aniž by se cokoli odehrálo. Kdybychom to přebírali, každá
nová FIDE listina by otevřela celou sezónu jako konflikty (na datech KSA 2025/26
jich bylo **416**, a všechny do jednoho jen posun Elo) — a odsouhlasit je by
znamenalo přepsat rating v už rozeslaném bulletinu. Rozhoduje stav partie
v _našem_ souboru: rozhodnutý `Result` nebo tahy = odehráno = zmrazeno; dokud je
šachovnice prázdná, Elo se dál aktualizuje jako každý jiný tag.

### Kde režim žije

Režim je **karta** (`Tab` typu `competition`), ne modal. Původně visel jako
fullscreen modal nad Soubory, což znamenalo, že existoval jen dokud existovala ta
stránka — po restartu se k němu nedalo vrátit. Otevírá se ze tří míst, všechna přes
jediný `openCompetitionTab()`:

- **Soubory** → tlačítko „Režim Vedoucí soutěže“ na kartě souboru,
- **Nová karta → Nedávné soubory** → kliknutí na soutěž ji otevře rovnou v režimu
  (otevřít 528 partií na partii č. 0 nikdy není, co vedoucí myslel),
- **Hlavičky** → tlačítko zpět nahoru na celou sezónu, když je otevřená jedna partie
  z ní.

Jedna soutěž = jedna karta: druhé otevření zaostří tu existující. Karta nedrží strom
tahů, takže její zavření se nikdy neptá na uložení.

Adresář soutěže se v seznamu souborů **ukazuje** (je v něm sezóna), archiv
`*.xml-archiv/` uvnitř něj se **vynechává** — je to účetnictví, ne databáze, a
prázdná složka vedle sezóny mate. Přejmenování `.pgn` v seznamu souborů táhne
manifest i archiv s sebou (`renameCompetitionSidecars`); samotný adresář si jméno
nechá, nic na něm nestojí.

### Adresář družstev (zkratky a místa konání)

Adresář (`directory.ts`) drží na družstvo dvě věci: **zkratku** do tagu `Event` a
**místo konání** do tagu `Site`. Obojí má odvozenou výchozí hodnotu a uloženou
ruční, která vyhrává:

- zkratka: projektový shortener `resolveCompetition` nad zabudovaným slovníkem klubů
  ŠSČR — tedy ten samý, co používá pgn-base, včetně rozpadu kolizí v rámci uzavřené
  množiny družstev jedné soutěže. Na datech KSA 2025/26 dostane všech 12 družstev
  rozumnou zkratku bez diakritiky a s písmenem družstva (`ŠK KDJS Sedlčany A` →
  `Sedlcany A`, `Cayman Pharma Neratovice B` → `Neratovice B`);
- místo: **zkratka bez samostatného písmene družstva** (`Sedlcany A` → `Sedlcany`),
  jako v pgn-base. Béčko hraje tam co áčko — písmeno je o týmu, ne o hale.

Prefix `Event` vznikne z `compAbbr` (`KSA 25/26`; region v XML není, takže vedoucí si
případné `SSS` doplní sám).

Odvození se **předvyplní při importu i re-syncu** (`prefillDirectory` v `storage.ts`)
a přepisují se jen prázdné hodnoty, takže ruční úpravy se po re-syncu nevrací zpátky
a nové družstvo v novějším XML zkratku i místo přesto dostane. Prázdný `site` uložený
naschvál znamená „bez místa“, ne „odvoď“.

Rozhodující je ale to, že se odvozuje i **při čtení** (`resolveDirectory`): dialog
„Zkratky soutěže“ i export sahají na tutéž funkci, takže soutěž založená dřív, než
adresář vznikl (v manifestu samé `null`), exportuje zkratky a místa taky — a vedoucí
v dialogu vidí přesně to, co export zapíše.

Adresář se uplatní **výhradně při exportu** — interní PGN drží plné názvy. `Site` se
bere podle **domácího družstva** zápasu (tedy ne z uloženého tagu `Site`, který je
zmrazený z importu, kdežto adresář vedoucí průběžně udržuje).

### Tagy, jména a vzory názvů (srovnáno s pgn-base, 2026-08-05)

Tři věci, kterými se export dorovnal na aktuální stav pgn-base
(`docs/feat-player-name-comma.md`, `docs/feat-name-patterns.md`,
`docs/feat-export-options-and-standard-columns.md`).

**1. `White`/`Black` = „Příjmení, Jméno“ — jedna funkce, dvě místa.**
`toPgnName()` se přestěhovala z `sscr/names.ts` do `utils/pgn/names.ts`, protože už
není jen o XML: běží **na vstupu** (kostra z XML, `api.chess.cz` přes
`toPgnPlayerName`, který je teď jen alias — dřív to byla druhá, horší kopie téhož
pravidla) **i na výstupu** (`toSscrGame` a `buildExportGame`). Import ji tedy dělá
kvůli tomu, co vidí uživatel v GUI, export kvůli tomu, co skutečně odejde: databáze
založená dřív nebo ručně upravená dostane čárku až tady. **Data se nemigrují**,
funkce je idempotentní.

Nově má guard na číslici, který v pgn-base je a v en-croissant chyběl — bez něj by
export ze zástupné šachovnice `Domácí 3` udělal `Domácí, 3`. Na vstupu to nevadilo
(jela jen nad soupiskou), na výstupu jde o všechny partie.

Rozdíl proti pgn-base: en-croissant otevírá **i cizí PGN**, kde jméno může být
v západním pořadí (`Magnus Carlsen`), a to by pravidlo rozbilo. V obecném dialogu
`Export PGN` je proto zaškrtávátko, **předvolené podle typu souboru** (zapnuté pro
soutěž/zápas, vypnuté jinde); profil ŠSČR normalizuje vždy — tam je zdroj dat známý.

**2. Standardní sada tagů je výchozí.** `STANDARD_TAGS` = STR + `ECO`, `WhiteElo`,
`BlackElo`, `PlyCount`, tedy přesně sada profilu ŠSČR (`SSCR_TAGS` je teď ta samá
konstanta) i `headers=standard` v pgn-base. Vypadly z ní `WhiteTeam`/`BlackTeam` —
družstva jsou naše účetnictví, čtenář bulletinu je nepotřebuje a v referenčním
bulletinu nejsou. Dialog startuje na „Standardní“ místo „Plné“; **ruční výběr tagů
zůstává** a je pořád nad presetem (odškrtnutí ho nepřepíše).

**3. `Event` i název souboru se skládají podle vzorů.** `utils/pgn/namePattern.ts`
(port z pgn-base), uložené per soutěž v `manifest.options.{eventPattern,filePattern}`
(`null` = výchozí). Výchozí vzory **přesně reprodukují** dosavadní formát, takže bez
zásahu se nic nemění:

|                 | výchozí vzor                 | výsledek                             |
| --------------- | ---------------------------- | ------------------------------------ |
| tag `Event`     | `{zkratka} {domaci}-{hoste}` | `KSA SSS 25/26 Sedlcany A-Kralupy B` |
| soubor PGN kola | `{soutez}_{kolo}`            | `ksa_01.pgn`                         |

Zástupné výrazy: `{zkratka}` (jak je uložená), `{soutez}` (první slovo, malými, ASCII),
`{kolo}` (dvojmístné), `{domaci}`, `{hoste}`. Neznámý výraz zůstane ve výstupu tak,
jak je, aby byl překlep vidět v náhledu. Edituje se v „Zkratky soutěže“ → sekce
**Vzory názvů**, s živým náhledem na prvním zápase prvního kola.

Pole nesou výchozí vzor jako **editovatelný text**, ne jako placeholder — vedoucí
upravuje ten, který zrovna platí, místo aby ho opisoval; vedle je tlačítko „Vrátit
výchozí“. Uloží se `null`, kdykoli pole říká totéž co výchozí vzor (nebo je prázdné),
takže manifest pořád rozlišuje „vlastní vzor“ od „výchozí“ a prázdný `Event` nemůže
vzniknout.

Formát `Event` má **jediné místo** v kódu — `composeEventName`
(import zápasu z chess.cz) volá týž `buildEventFromPattern`, jen bez možnosti vzor
změnit, protože tam žádný manifest není.

Název souboru dostal navíc **úroveň stromu** (`exportFileBase`), což je mapování
pgn-basových kontejnerů na náš strom:

| scope  | název                  | odpovídá v pgn-base |
| ------ | ---------------------- | ------------------- |
| soutěž | název souboru soutěže  | sezóna              |
| kolo   | vzor `{soutez}_{kolo}` | kolo                |
| zápas  | vlastní `Event`        | zápasová DB         |
| partie | `Bily_Cerny`           | jedna partie        |

Všechno prochází `sanitizeFileBase` (diakritika → ASCII, jen `[A-Za-z0-9_-]`), takže
z `Krajská soutěž 'A' – 3. kolo` je `Krajska_soutez_A_3_kolo.pgn`, ne mojibake.
Dialog exportu ŠSČR ukazuje výsledný `Event` **z první skutečně exportované partie**
(dřív zástupné `PREFIX A-B`) a název souboru, takže špatný vzor je vidět dřív, než
soubor vznikne.

### Nástroje se scopem

`Kontrola`, `Export PGN` i `Import tahů` berou nepovinný `ToolScope` (indexy
partií + popisek). Pracují nad podmnožinou a výsledek zase vloží zpět, takže
oprava na jedné úrovni nesáhne na nic mimo ni. Kontrola navíc bere `matchChecks`,
vypnuté nad úrovní zápasu: „jeden Event, barvy se střídají po šachovnicích“ je
invariant zápasu, ne ročníku — jinak by se označilo všech 528 partií.

**Import tahů bere víc souborů najednou a přetažení.** Kapitán typicky pošle osm
jednopartiových PGN, ne jeden osmipartiový, takže výběr souboru je `multiple` a
všechny se přečtou do jednoho proudu partií (párování pak běží jako dřív). Nad
tlačítkem je zóna, na kterou jdou soubory přetáhnout: Tauri má vlastní drag-drop
zapnutý (výchozí stav), takže webview žádný HTML5 `drop` nedostane — poslouchá se
`getCurrentWebview().onDragDropEvent` a čtou se cesty, které přijdou v události.
Ne-`.pgn` soubory se zahodí s hláškou. Posluchač volá handler přes ref: registruje
se při otevření dialogu, kdy `targets` jsou ještě prázdné, a bez refu by párování
běželo proti prázdnému seznamu.

Samotný posluchač ale nestačí: `routes/__root.tsx` má **celoaplikační** handler na
`TauriEvent.DRAG_DROP`, který každé přetažené PGN otevře jako novou databázi — a
událost dostanou oba, takže dialog ji nemůže „spotřebovat“. Kdo přetažení vlastní,
řeší `utils/fileDrop.ts`: dialog si ho po dobu svého života **zamluví**
(`claimFileDrop`) a kořenový handler na zamluvený drop nesahá. Je to čítač, ne
příznak — dva dialogy se při zavírací animaci můžou překrýt a ten mizející nesmí
zamluvení vrátit za ten druhý.

### Šířka stromu

Strom je hluboký (`11. kolo` → `Sedlčany A – Klokani z Kralup` → osm partií), takže
jedna napevno daná šířka nevyhoví. Dělicí čára mezi stromem a seznamem partií se
**táhne myší** (180–720 px, dvojklik = výchozích 320), hodnota se drží v
`localStorage` globálně — je to zvyk uživatele, ne vlastnost soutěže. Táhne se přes
`pointermove` na `window`, ne na tom 5px proužku: kurzor ho při rychlém tahu předběhne
a drag by se ztratil. Šipky ←/→ dělají totéž z klávesnice po 16 px.

Svislé posouvání mají obě části na starosti `ScrollArea`, ale dlouho nefungovalo ani
v jedné — kvůli dvěma nezávislým chybám v řetězci výšek.

Zaprvé **`Group` se defaultně zalamuje**. Ve víceřádkovém flex kontejneru se
`align-items: stretch` vztahuje k _řádku_, jehož výška je dána nejvyšší položkou —
strom i seznam partií si tedy nastavily výšku podle svého obsahu (4600px strom v 600px
panelu) a jejich `ScrollArea` neměly co oříznout. `wrap="nowrap"` udělá z obou jediný
řádek, jehož výška je výška kontejneru; teprve pak se ořezává a scrolluje. Je to tedy
**nosný prop, ne kosmetika** — hlídá ho test v `CompetitionView.test.tsx` (jsdom výšky
nepočítá, takže se kontroluje samotný prop).

Zadruhé **výška karty** v `BoardsPage.tsx`.
`Tabs.Panel` měl `h="100%"`, což je 100 % celého sloupce karet — panel tedy začínal
pod lištou karet a končil právě o tu lištu **pod spodním okrajem okna**. Šachovnici
to nevadí (Mosaic se pozicuje sám), ale cokoli, co scrolluje, mělo viewport zasahující
pod okraj obrazovky, takže se na poslední řádky nedalo dojet. Správně je `flex: 1`
(+ `minHeight: 0`), tedy zbývající místo.

### Pravý panel je „Hlavičky“

Pravá část dřív měla vlastní tabulku (kolo / bílý / černý / výsledek / tahy) — pátý
pohled na tytéž partie, který uměl míň než ostatní čtyři. Teď je to **stejný grid
jako blok „Hlavičky“ na šachovnici** (`components/panels/headers/HeadersGrid.tsx`),
vytažený z `HeadersPanel` tak, aby ho oba mohly sdílet.

Grid o výběru nerozhoduje sám: `games` je **vždy celý soubor**, indexově zarovnaný
s ním, a `rows` říká, které z těch indexů zobrazit. Každý index, který grid vydá
(`onOpen`, `onWritten`, mapa rozeditovaných buněk), je proto index do souboru —
zúžený grid zapisuje na přesně stejná místa jako nezúžený a hostitel nic
nepřepočítává. Výběr ve stromu tak dává čtyři varianty jednoho pohledu: 1 partie /
zápas / kolo / celá soutěž. Hromadná náhrada hodnot tagu zůstala, ale schovala se
pod tlačítko, aby na grid zbylo místo.

### Výběr se pamatuje a cestuje s partií

`BoardsPage` renderuje karty s `keepMounted={false}`, takže se `CompetitionView` při
přepnutí karty odmountuje. Výběr uzlu a rozbalené větve se proto ukládají do
`localStorage` **per soubor** (`competition-tree-state`, posledních 20 souborů) a při
návratu se obnoví. Uzel, který mezitím ze stromu zmizel (re-sync, přečíslované kolo),
spadne zpátky na celou soutěž.

Proklik na partii navíc předá **úroveň, ze které se otevřela**: karta nese nepovinný
`gameScope` (`utils/tabs.ts`) a `scopedIndices` z něj dělá seznam indexů, který
respektuje jak grid „Hlavičky“, tak výběr partií v `InfoPanel` včetně klávesových
zkratek na další/předchozí partii. Na šachovnici se tedy neukáže celé PGN sezóny, ale
jen to kolo nebo zápas, ve kterém uživatel pracuje. `GameScope` má tvar `ToolScope`,
takže se stejným zúžením běží i Kontrola, Import a Export; příznak `matchLevel` říká,
jestli dávají smysl zápasové kontroly (jednotný `Event`, střídání barev). Zúžení je
vždy vidět jako štítek s křížkem (`GameScopeChip`) — krátký seznam bez vysvětlení
vypadá jako ztracená data.

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

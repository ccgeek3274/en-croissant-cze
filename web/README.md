# web/ — stránka encroissant.sachytynec.cz

Jednostránkový statický web české verze. Žádný build, žádné závislosti: jeden
soubor `index.html`, veškerý styl je v něm (žádné externí fonty ani skripty), takže
se dá nasadit i pouhým přetažením složky.

## Nasazení na Cloudflare Pages

**Přes web (Direct Upload)** — nejrychlejší cesta:

1. Cloudflare → _Workers & Pages_ → _Create_ → _Pages_ → _Upload assets_
2. Název projektu např. `encroissant-cz`, nahrát obsah adresáře `web/`
   (tj. `index.html`, ne celou složku zabalenou do podadresáře)
3. _Custom domains_ → přidat `encroissant.sachytynec.cz`. Doména musí být
   v Cloudflare; DNS záznam si Pages založí samy.

**Přes CLI** (`wrangler`), když se bude nasazovat opakovaně:

```bash
npx wrangler pages deploy web --project-name encroissant-cz
```

**Z GitHubu** — jde napojit i repozitář: build command nechte prázdný,
_build output directory_ nastavte na `web`.

## Údržba

- Odkazy na stažení míří na
  `https://github.com/ccgeek3274/en-croissant-cze/releases` — číslo verze se na
  stránce záměrně neuvádí, aby nezastarávalo.
- Podrobnosti o samotném programu na stránku nepatří; od toho je odkaz na
  `encroissant.org/docs`. Tady se popisuje jen to, co je v české verzi navíc.
- Text stránky by měl odpovídat tomu, co program opravdu umí — při větší nové
  funkci přidejte kartu do sekce „Co je navíc“.

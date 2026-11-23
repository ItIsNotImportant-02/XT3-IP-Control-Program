# XT3 Control

Program pro ovládání serveru **EVS XT3** z PC. Zobrazí celou stránku klipů (page / bank / F1–F10 / kamery A–D…) a **kliknutím myší se klip hned pustí do výstupu**, bez playlistů.

Komunikuje se serverem standardním protokolem **VDCP** po RS‑422 (USB převodník). Pro vývoj a vyzkoušení má vestavěný **simulátor XT3**, takže funguje i bez serveru.

> Stav: první verze k otestování ve voze. Na skutečném EVS zatím nevyzkoušeno. Postup testu je v [docs/test-ve-voze.md](docs/test-ve-voze.md).

## Co umí

- Stránka klipů jako na EVS, přepínání stránek myší nebo PageUp/PageDown.
- **Klik na kameru v buňce = načíst (cue) a pustit (play)**. Probíhající klip svítí červeně.
- Pojistka: po spuštění je program **ZAJIŠTĚNÝ** a kliknutí nic nepustí. Odjistí se tlačítkem vpravo nahoře.
- Pauza (STILL), Pokračovat (CONTINUE), Stop (černá, s potvrzením).
- Stav kanálu, aktivní klip a timecode.
- Log komunikace v hexu (tlačítko „Log komunikace“) pro ladění na místě.
- Režim **Test PGM/PRV**: klip se načte a pustí na kanálu PRV. Slouží k ověření, jestli EVS samo udělá prolínačku.
- Program **neumí a nikdy nepošle** příkazy pro nahrávání ani mazání klipů. Jsou v kódu zablokované.

Zatím neumí: prolínačku (čeká na test ve voze), náhledy klipů a jména klipů z LSM (VDCP posílá jen ID).

## Instalace na Windows do `D:\Projects\XT3-Control`

1. Nainstaluj **Node.js LTS** (verze 20 nebo novější) z <https://nodejs.org>. Stačí výchozí volby instalátoru.
2. Nainstaluj **Git for Windows** z <https://git-scm.com>. Bez Gitu jde stáhnout ZIP z GitHubu (tlačítko Code → Download ZIP) a rozbalit do `D:\Projects\XT3-Control`.
3. Otevři **příkazový řádek** (Win+R, napiš `cmd`, Enter) a spusť:

   ```bat
   cd /d D:\Projects
   git clone https://github.com/ItIsNotImportant-02/XT3-IP-Control-Program.git XT3-Control
   cd XT3-Control
   npm install
   ```

   Repozitář je soukromý, takže se Git může zeptat na přihlášení ke GitHubu. Dokud není tato verze sloučená do hlavní větve, přidej ke `git clone` ještě `-b claude/project-thread-ftzju8`.

4. Spuštění: dvojklik na **`start.bat`** ve složce `D:\Projects\XT3-Control`, nebo v příkazovém řádku `npm start`.
   Otevře se prohlížeč s adresou <http://localhost:8080>. Program běží, dokud je otevřené černé okno.

Aktualizace na novější verzi: v příkazovém řádku ve složce programu `git pull` a pak `npm install`.

## Připojení k EVS

1. Na EVS nastav jeden volný RS‑422 port na protokol **VDCP** a přiřaď ho přehrávacímu kanálu (viz [docs/test-ve-voze.md](docs/test-ve-voze.md)).
2. Připoj USB→RS‑422 převodník kabelem podle [docs/zapojeni-rs422.md](docs/zapojeni-rs422.md).
3. V programu klikni na **⚙**, zvol „RS‑422“, vyber COM port převodníku a dej **Uložit a připojit**.
4. Klikni na **↻ Načíst klipy**.

Nastavení se ukládá do `config.json` ve složce programu.

## Simulátor

Výchozí nastavení je simulátor, takže po prvním spuštění uvidíš vymyšlené klipy a můžeš si vše vyzkoušet. Samostatný simulátor na TCP (pro test přes síť nebo převodník): `npm run sim -- --tcp 9000`.

## Odposlech LSM ovladače

Nástroj pro záznam komunikace mezi LSM ovladačem a serverem (kvůli prolínačce): `npm run sniff -- --a COM5 --b COM6`. Zapojení a postup jsou v [docs/zapojeni-rs422.md](docs/zapojeni-rs422.md).

## Pro vývojáře

- `src/vdcp/` – VDCP protokol (rámování, checksum, příkazy, seznam povolených příkazů)
- `src/sim/` – simulátor XT3
- `src/controller.js` – logika (připojení, klipy, spuštění klipu)
- `src/server.js` – lokální web server, rozhraní v `public/`
- `tools/` – simulátor a odposlech
- Testy: `npm test`

Podklady: [docs/pruzkum-ovladani-xt3.md](docs/pruzkum-ovladani-xt3.md).

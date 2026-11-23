# Test ve voze – postup

Cíl: ověřit, co na skutečném XT3 funguje, a sebrat data pro další verzi. Vše mimo přenos.

Vezmi s sebou: notebook s programem (vyzkoušený na simulátoru), 1–3 USB→RS‑422 převodníky, kabely podle [zapojeni-rs422.md](zapojeni-rs422.md), multimetr (ideálně osciloskop).

## 0. Zapiš si

- [ ] Verzi softwaru (Multicam) na XT3 – je vidět při startu serveru a v Setup.
- [ ] Seznam licencí (okno Options / License codes) – vyfoť.
- [ ] Režim serveru a počet kanálů (LSM, Spotbox, počet IN/OUT).

## 1. Nastavení portu VDCP na EVS

V konfiguraci serveru (Multicam Setup → záložka Channels / Protocol, podle verze) přiřaď jednomu výstupnímu kanálu **ovládání protokolem VDCP** na volném RS‑422 portu. Kanál, který řídí LSM ovladač, typicky nejde zároveň řídit protokolem. Vyfoť obrazovky nastavení, ať víme, co přesně se dá zvolit (hlavně jestli jde zvolit „PGM/PRV“ nebo „mix“ pro protokolový kanál).

## 2. Základní test programu (režim Střih)

- [ ] V programu ⚙ → RS‑422 → COM port → Uložit a připojit. Stav „připojeno“?
- [ ] ↻ Načíst klipy. Objevily se klipy? **Jak vypadají jejich ID** (např. `111A`, `111A/01`, jméno)? Vyfoť nebo zkopíruj log.
- [ ] Odjisti a klikni na klip. Pustil se? Kolik ms ukázal program?
- [ ] Ukazuje se správně stav (PLAY), aktivní klip a timecode?
- [ ] Pauza / Pokračovat fungují?
- [ ] Klik na klip, který se právě nahrává (pokud jde) – co udělá?
- [ ] Na konci otevři **Log komunikace** a celý ho zkopíruj (Ctrl+A, Ctrl+C) do souboru.

## 3. Test prolínačky přes PGM/PRV

- [ ] Nastav na EVS dva kanály jako PGM/PRV s mixem (pokud jde u protokolu).
- [ ] V programu ⚙ → Spuštění klipu: „Test PGM/PRV“ → zvol COM porty pro PGM i PRV.
- [ ] Klikni na klip. Prolnul se do výstupu, nebo se jen pustil na PRV?

## 4. Odposlech LSM ovladače

Postup v [zapojeni-rs422.md](zapojeni-rs422.md#2-odposlech-lsm-ovladače-jen-poslech). Nahraj hlavně:

- [ ] Recall klipu do PRV (několik různých klipů).
- [ ] Take s prolínačkou (a pokud jde, různé délky prolínačky).
- [ ] Take bez prolínačky (střih).
- [ ] Play, pauza, změna rychlosti.

## 5. Pošli mi

Fotky nastavení, verzi softwaru, log z programu a soubory `logs\sniff-*.txt`. Podle toho dodělám prolínačku a opravím, co se na EVS chová jinak než v simulátoru.

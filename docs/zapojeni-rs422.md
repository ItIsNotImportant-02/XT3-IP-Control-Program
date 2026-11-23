# Zapojení RS‑422

## Co koupit

- **USB→RS‑422 převodník** se 4 vodiči (TX+, TX−, RX+, RX−) a zemí, nejlépe s čipem **FTDI** (Windows ho rozpozná bez potíží). Na ovládání stačí 1 kus. Na odposlech LSM ovladače 2 kusy navíc.
- **Konektory DB9 samec** (na EVS jsou porty RS‑422 jako DB9 samice) a kousek stíněného kabelu se 2 kroucenými páry.
- Na odposlech: **DB9 samec + DB9 samice** na „T“ (odbočku), aby šel původní kabel ovladače protáhnout a zároveň z něj odbočit.

Alternativa k USB: **převodník Ethernet ↔ RS‑422** (serial device server, např. Moxa NPort). Program se pak připojí volbou „TCP“ v nastavení (IP adresa a port převodníku, převodník nastavit na 38400 Bd, 8 bitů, lichá parita, režim TCP server / raw).

Pokud je převodník jen „RS‑485“, musí umět plný duplex (4 vodiče). Dvouvodičový RS‑485 nestačí.

## Piny DB9 (standard Sony 9‑pin, který používá i VDCP)

| Pin | Na straně serveru (EVS) | Na straně ovladače (PC) |
|---|---|---|
| 2 | TX− (A) – server vysílá | RX− |
| 7 | TX+ (B) – server vysílá | RX+ |
| 3 | RX+ (B) – server přijímá | TX+ |
| 8 | RX− (A) – server přijímá | TX− |
| 1, 4, 6, 9 | zem | zem |

Rozložení odpovídá dokumentaci VDCP a [návodu Vizrt pro EVS](https://docs.vizrt.com/viz-engine-guide/5.4/EVS_Video_Server_Control.html). **Na konkrétním XT3 to ověř** v Hardware manuálu (kapitola RS‑422 / Remote ports) nebo multimetrem, než kabel zapojíš.

## 1. Ovládání (program ↔ EVS)

**Na EVS použij port RS‑422 číslo 2 až 6, ne port 1.** Podle rešerše může port 1 sloužit i pro vzdálený reset serveru (reset jumper).

| Převodník | → pin DB9 na EVS |
|---|---|
| TX+ | 3 |
| TX− | 8 |
| RX+ | 7 |
| RX− | 2 |
| GND | 4 (nebo 1) |

Nastavení linky: **38400 Bd, 8 bitů, lichá parita (odd), 1 stop bit**. Program to nastaví sám.

Když server neodpovídá (v logu samé „timeout“), nejčastěji jsou prohozené + a − u jednoho páru. Zkus prohodit TX+ s TX− nebo RX+ s RX−. RS‑422 se tím nepoškodí.

## 2. Odposlech LSM ovladače (jen poslech)

Cíl: zaznamenat, co ovladač posílá serveru, když ručně uděláš „klip do PRV“ a „Take s prolínačkou“, a pak totéž poslat z programu.

**Důležité:** z převodníků se zapojují **jen přijímací vodiče RX+ a RX− a zem**. Vysílací vodiče TX nech nezapojené (zaizoluj je). Pak převodník na linku nic nepošle a ovladač se serverem fungují dál normálně.

Odbočka se vloží do kabelu (nic nezapojuj „naslepo“ do portu 1, viz výše) mezi LSM ovladač a jeho port na EVS:

| Převodník | Poslouchá směr | RX+ na pin | RX− na pin | GND |
|---|---|---|---|---|
| A | ovladač → server | 3 | 8 | 4 |
| B | server → ovladač | 7 | 2 | 4 |

(Piny jsou na konektoru směrem k serveru. Platí za předpokladu, že port ovladače má stejné rozložení jako Sony 9‑pin. To je potřeba ověřit: na aktivním páru je při komunikaci vidět změna napětí multimetrem / osciloskopem.)

### Postup

1. Zapoj odbočku, převodníky do PC, zjisti jejich COM porty (Správce zařízení → Porty).
2. Ve složce programu spusť:

   ```bat
   npm run sniff -- --a COM5 --b COM6
   ```

3. Na ovladači dělej **vždy jen jednu akci** a před ní napiš do okna poznámku a dej Enter, např. `recall 111A na PRV`, `take mix`, `play`.
4. Záznam se uloží do `logs\sniff-<datum>.txt`. Ten mi pošli.

Rychlost a parita linky ovladače nejsou známé. Když se v záznamu objevují nesmysly nebo nic, zkus jinou rychlost, např.:

```bat
npm run sniff -- --a COM5 --b COM6 --baud 38400 --parity odd
npm run sniff -- --a COM5 --b COM6 --baud 115200 --parity none
npm run sniff -- --a COM5 --b COM6 --baud 19200 --parity odd
```

Správné nastavení poznáš tak, že se při každé akci opakují podobné, smysluplné sekvence bajtů. Nejjistější je změřit osciloskopem délku jednoho bitu (např. 26 µs = 38400 Bd, 8,7 µs = 115200 Bd).

Odposlech dělej jen při instalaci, ne během přenosu.

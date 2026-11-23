# Průzkum: dá se EVS XT3 ovládat z vlastního programu přes PC?

Datum: 23. 11. 2026

## Krátká odpověď

Ano, je to reálné, ale ne „přes Ethernet jako IPDirector“ hned od začátku. XT3 má několik **standardních, veřejně popsaných protokolů** (Sony 9‑pin / BVW‑75, VDCP, Odetics), které běží po **RS‑422** (9pinové sériové porty na zadní straně serveru). Na ty existují hotové open‑source knihovny a stačí k nim USB→RS‑422 převodník. To je bezpečná cesta, jak začít.

Opravdové ovládání přes Ethernet (to, co používá IPDirector) jde přes **EVS LinX API** a proprietární protokol IPDirectoru (IPDP). Ty **nejsou veřejně zdokumentované**, EVS je dává partnerům. Bez nich by to znamenalo reverse engineering, což je pomalé a v živém provozu riskantní.

Žádnou „ochranu“, která by server zamkla, když do něj posíláte příkazy, jsem nenašel. Reálná rizika jsou jiná: zastavení nahrávání nebo smazání klipů špatným příkazem, rozbití konfigurace přes telnet/FTP a ztráta podpory od EVS. Viz kapitola Rizika.

## 1. Jaké ovládací protokoly XT3 má

Podle brožury XT3 (spec sheet XT3‑TECH SPEC 0211) a konfiguračního manuálu XT3 12.05:

| Protokol | Fyzicky | Veřejná dokumentace | Poznámka |
|---|---|---|---|
| **Sony BVW‑75 (Sony 9‑pin / P1)** | RS‑422 | Ano, de facto standard, desítky popisů a knihoven | Transport (play, stop, cue, jog, shuttle, varispeed), timecode. Klipy jen omezeně. |
| **VDCP (Harris/Louth)** | RS‑422 | Ano, specifikace koluje veřejně | Navržen pro „video disk“ servery: klipy podle ID, cue/play, seznam klipů. |
| **Odetics** | RS‑422 | Částečně | Rozšíření Sony protokolu o práci s klipy. |
| **EVS AVSP** | RS‑422 | Ne veřejně, EVS ji dává integrátorům | EVS rozšíření Odetics. Brožura: „AVSP for RS‑422 integration“. |
| **Thomson XtenDD35** | RS‑422 | Málo | Používá ho např. Viz Engine pro ovládání EVS. |
| **EditRec, RS422 VarID** | RS‑422 | Částečně | Speciální režimy pro střižny / proměnná ID klipů. |
| **IPDP** (IPDirector protocol) | proprietární | Ne | Tímto IPDirector ovládá kanály. |
| **EVS LinX API** | Ethernet (TCP/IP) | Ne veřejně | Brožura: „LinX API for TCP/IP integration“. EVS Cerebrum ho uvádí pro XT / XT‑VIA (transport, klipy, timeline, konfigurace). |
| LSM Remote (ovladač) | RS‑422 | Ne | Vlastní protokol mezi ovladačem a serverem. |

Další síťové služby na XT3 (PC LAN port): webová konfigurace na `http://<IP>/cfgweb/`, telnet a FTP (konfigurace a údržba), SNMP, XNet Monitor. Gigabit porty slouží k importu/exportu souborů, XNet (SDTI po BNC) k síti mezi servery EVS.

Hardware: XT3 má 6× RS‑422 (6U šasi) nebo 4× RS‑422 (4U), 2× RS‑232, 12× GPI.

**Důležité:** Které protokoly jsou na kterém kanálu dostupné, záleží na verzi softwaru (Multicam) a na režimu (LSM, Spotbox/server, IPDirector). Kanál, který ovládá LSM ovladač, obvykle nejde zároveň ovládat externím protokolem, takže se v konfiguraci vyhrazuje kanál pro „externí“ řízení. Některé režimy a funkce jsou vázané na licenční kódy (viz Rizika).

## 2. Je to veřejně zdokumentované? Dělal to už někdo?

- **Sony 9‑pin / BVW‑75:** ano, úplně. Hotové knihovny: [sony9pin-nodejs](https://app.unpkg.com/sony9pin-nodejs@0.6.5/files/README.md) (Node.js), [Sony9Pin.net](https://awesome.ecosyste.ms/projects/github.com%2Flathoub%2Fsony9pin.net) (C#), [Sony9PinRemote](https://reference.arduino.cc/reference/en/libraries/sony9pinremote) (Arduino), [vcr4j](https://github.com/mbari-org/vcr4j) (Java). Popis protokolu je i na [Wikipedii](https://en.wikipedia.org/wiki/9-Pin_Protocol).
- **VDCP:** veřejná specifikace existuje, implementace jsou v řadě automatizací.
- **Komerční systémy, které XT3/EVS ovládají:** Viz Engine (přes XtenDD35 po RS‑422, [dokumentace Vizrt](https://docs.vizrt.com/viz-engine-guide/5.4/EVS_Video_Server_Control.html)), Ross switchery (VDCP, [Ross help](https://help.rossvideo.com/acuity-device/Topics/Devices/Video-Server/EVS.html) – pro maXS, princip stejný), EVS Cerebrum (LinX API po Ethernetu, [protocol list V2.9](https://evs.com/sites/default/files/2026-08/Cerebrum%20-%20product%20Sheet%20%2B%20protocol%20list%20V2.9.pdf)), Evertz Magnum ([seznam podpory](https://cn.evertz.com/solutions/magnum/magnum_third_party_support.pdf)), Mosart a další automatizace.
- **Open‑source projekt přímo pro EVS XT3:** nenašel jsem žádný. Na fóru vvvv se na to někdo [ptal](https://vvvv.org/node/51818) bez odpovědi. GitHub „evs-python-automation“ je jiný produkt (Earth Volumetric Studio), ne EVS broadcast.
- **LinX API / IPDP / LSM remote protokol:** veřejně nejsou. Dokumentace se získává od EVS (partnerství, integrační projekt, často pod NDA).

## 3. Bude potřeba reverse engineering?

- **Pro základ ne.** Přehrávání, cue, jog/shuttle, varispeed, nahrávání, přepínání a načítání klipů zvládnete přes Sony 9‑pin / VDCP / Odetics, které jsou zdokumentované.
- **Pro „IPDirector‑like“ věci ano, nebo dokumentaci od EVS.** Procházení databáze klipů, metadata, playlisty, práce přes Ethernet, ovládání víc kanálů jedním kabelem, synchronizace s XNet sítí – to je LinX/IPDP. Bez dokumentace by se to muselo odposlouchávat (např. Wireshark mezi IPDirectorem a serverem, nebo sniffování RS‑422 mezi LSM ovladačem a serverem).
- **Právní stránka (není to právní rada):** odposlech komunikace vlastního zařízení kvůli interoperabilitě je v EU obecně v šedé až povolené zóně. Směrnice 2009/24/ES čl. 6 a český autorský zákon (§ 66) dovolují dekompilaci kvůli interoperabilitě za určitých podmínek. Licenční smlouva EVS (EULA, servisní smlouva) ale může reverse engineering zakazovat a porušení může znamenat ztrátu podpory. Pokud server nevlastníte vy (firma, televize, půjčovna), potřebujete svolení vlastníka. Výsledek reverse engineeringu by neměl jít volně zveřejnit, pokud obsahuje kód nebo dokumentaci EVS.

## 4. Rizika: zamčení, pády, síť, záruka

**Zamčení / licence**
- XT3 má licenční (option) kódy vázané na sériové číslo serveru a hardwarový klíč. Mohou být trvalé, dočasné nebo demo. Neplatný kód znamená jen, že funkce je „not granted“. Nenašel jsem žádný mechanismus, který by server zamkl za to, že ho ovládá cizí program.
- Pozor na: dočasné/demo licence, které vyprší, a na to, že některé režimy (Spotbox, IPDirector, protokolové kanály) mohou potřebovat konkrétní licenci. Zjistěte v okně Options codes, co má váš server povolené.
- Konfiguraci může chránit heslo. To blokuje změny nastavení, ne provozní příkazy.

**Pády a ztráta dat**
- Standardní sériové protokoly jsou na serveru dobře ošetřené (používají je automatizace 24/7). Špatný příkaz typicky jen ignoruje nebo vrátí NAK.
- Reálné riziko je logické: příkaz Stop Record, Eject, smazání klipu nebo přepsání klipu na kanálu, který zrovna nahrává živé vysílání. To je nevratné.
- Telnet/FTP a cfgweb: změny konfigurace mohou server rozbít nebo smazat média (manuál varuje, že „Clear media“ trvale maže i chráněné klipy). Manuál: „Most parameters are factory preset, and should not be modified without advice of qualified EVS staff.“
- Neznámé příkazy nebo zprávy poslané při reverse engineeringu mohou vyvolat stav, který vyřeší jen restart serveru.

**Síť**
- XNet (SDTI po BNC) a gigabit síť sdílí víc serverů. Experimenty s proprietárními pakety na produkční síti mohou ovlivnit ostatní servery a IPDirector. Testujte jen na odpojeném serveru nebo na izolované síti.
- PC LAN port nastavte do vlastní izolované podsítě (přímý kabel), nepouštějte do něj nic jiného.

**Záruka a podpora**
- Používání standardních protokolů je normální provoz, záruku neruší.
- Zásahy do softwaru serveru, neautorizované úpravy konfigurace nebo reverse engineering mohou porušit podmínky licence a servisní smlouvy s EVS.

## 5. Doporučený postup

1. **Zjistit, co máte:** verzi Multicam softwaru na XT3, počet kanálů, režim (LSM / Spotbox / IPDirector), seznam aktivních licencí (Options codes), a jestli máte LSM ovladač a IPDirector.
2. **Sepsat, jaké funkce chcete,** které na ovladači nejdou. Podle toho se pozná, jestli stačí standardní protokoly.
3. **Pokus na neživém serveru:** v konfiguraci vyhradit jeden kanál pro externí řízení (Sony BVW‑75 nebo VDCP) na volném RS‑422 portu. Připojit USB→RS‑422 převodník (FTDI, cca 30–100 €) se správným zapojením (38400 Bd, 8 bitů, odd parita, 1 stop bit; zapojení pinů je ve [Viz dokumentaci](https://docs.vizrt.com/viz-engine-guide/5.4/EVS_Video_Server_Control.html)).
4. **První verze programu:** PC aplikace přes hotovou knihovnu Sony 9‑pin/VDCP. Přidané funkce můžou být třeba makra, klávesové zkratky, Stream Deck, časované sekvence, vlastní jog, seznamy klipů. Nebezpečné příkazy (stop record, delete) za potvrzením nebo úplně vypnuté.
5. **Paralelně požádat EVS** (support / partnerský program) o dokumentaci AVSP a LinX API. Pokud ji dostanete, máte legální cestu k ovládání přes Ethernet a k databázi klipů.
6. **Reverse engineering až jako poslední možnost,** pouze pasivním odposlechem na vlastním testovacím serveru, ne na produkci.

## 6. Co od vás potřebuju vědět

- Verze softwaru XT3 a jestli je server váš / k dispozici na testy mimo provoz.
- Jaké konkrétní funkce chcete, které ovladač neumí.
- Jestli máte IPDirector nebo LSM ovladač (kvůli případnému porovnání a odposlechu).

## Zdroje

- [XT3 brožura / spec sheet](https://cvp.com/pdf/evs_xt3_brch.pdf)
- [XT3 Configuration Manual 12.05](https://www.avbroadcast.fr/media/productfile/e/v/evs-xt3-manuel.pdf)
- [XT3 User Manual 11.00 (licence, PC LAN)](https://manualmachine.com/evs/xt3/1392695-user-manual-version-11)
- [Options codes management window (XT3 11.00)](https://manualsdir.com/manuals/254317/evs-xt3-version-1100-configuration-manual.html?page=36)
- [EVS Cerebrum – seznam protokolů V2.9](https://evs.com/sites/default/files/2026-08/Cerebrum%20-%20product%20Sheet%20%2B%20protocol%20list%20V2.9.pdf)
- [Vizrt – EVS Video Server Control](https://docs.vizrt.com/viz-engine-guide/5.4/EVS_Video_Server_Control.html)
- [Ross Video – EVS (VDCP)](https://help.rossvideo.com/acuity-device/Topics/Devices/Video-Server/EVS.html)
- [Evertz Magnum – third party support](https://cn.evertz.com/solutions/magnum/magnum_third_party_support.pdf)
- [Wikipedia – 9‑Pin Protocol](https://en.wikipedia.org/wiki/9-Pin_Protocol)
- [vvvv fórum – dotaz na ovládání EVS](https://vvvv.org/node/51818)
- [EVS – licencování XT‑VIA (2024)](https://evs.com/company/news/evs-redefines-production-flexibility-new-licensing-model-xt-via)

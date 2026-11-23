// Rozklad ID klipu EVS (LSM ID) na stránku, banku, pozici a kameru.
// Příklad: "123B" nebo "123B/01" = stránka 1, banka 2, pozice 3, kamera B,
// server 01. Pozice 0 se zobrazuje jako 10.
// Jak přesně EVS pojmenovává klipy přes VDCP, je potřeba ověřit na serveru.

const LSM_ID = /^(\d)(\d)(\d)([A-Za-z])(?:\/(\d{1,2}))?$/;

export function parseLsmId(id) {
  const m = LSM_ID.exec(String(id).trim());
  if (!m) return null;
  const page = Number(m[1]) || 10;
  const bank = Number(m[2]) || 10;
  const position = Number(m[3]) || 10;
  return {
    id,
    page,
    bank,
    position,
    cam: m[4].toUpperCase(),
    server: m[5] ? Number(m[5]) : null,
  };
}

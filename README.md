# PokScanner

Lokale Pokémon-kaartenscanner: foto of webcam, OCR, herkenning via [TCGdex](https://tcgdex.dev/) en een eigen collectie met Cardmarket-prijzen.

## Starten

Je hebt **Node.js 20+** nodig.

```bash
npm install
npm run dev
```

Open daarna [http://localhost:5173](http://localhost:5173).

- Frontend: Vite + React + TypeScript
- API: Node.js + Express op poort `3001`
- Catalogus en prijzen: TCGdex (geen API-key)

## Zo werkt een scan

1. Leg de kaart in het kader of upload een scherpe foto.
2. De server recht de foto, verhoogt het contrast en leest tekst met Tesseract.
3. Naam en collectornummer (`025/165`) worden gematcht tegen de TCGdex-catalogus.
4. Je ziet de kaart, set, rarity en de Cardmarket-trendprijs in euro.
5. Voeg de kaart toe aan je collectie. Die staat per account in `data/collection.json`.

Tips voor betere herkenning: recht van boven, weinig glare op holo’s, collectornummer onderaan leesbaar. Kaarttaal (EN/FR/DE/ES/IT) stel je in via de selector bovenin.

## Inloggen

Maak een account met e-mail en wachtwoord (minstens 8 tekens). Daarna kun je inloggen op dezelfde pagina.

In Dokploy optioneel:

- `BETTER_AUTH_SECRET` (lange random string)
- `BETTER_AUTH_URL=https://scanner.thisisours.duckdns.org`

## Deploy (Dokploy + Nixpacks)

De repo bevat `nixpacks.toml`. In Dokploy:

1. Builder: **Nixpacks**
2. Healthcheck: `/api/health`
3. **Poort in de app: `3000`** (containerpoort). Dat is niet 9999. 9999 is alleen de publieke poort van je andere app.
4. Domein: `scanner.thisisours.duckdns.org` (eigen DNS, niet dezelfde host-mapping als die andere app)
5. Persistent volume (aanbevolen): mount naar `/app/data`
6. Environment:
   - `BETTER_AUTH_URL=https://scanner.thisisours.duckdns.org`
   - `BETTER_AUTH_SECRET` (optioneel maar aangeraden)
   - `PORT=3000` als Dokploy die niet zelf zet

Een 502 betekent: Traefik/Caddy komt niet bij Node. Meestal staat de Dokploy-poort dan op 9999 of 3001 in plaats van **3000**.

De site is een **PWA**. Op telefoon: “Installeer als app”, of op iPhone Deel → Zet op beginscherm.

Geen API-keys nodig voor de catalogus (TCGdex). Voor scans mag de reverse-proxy uploadlimiet 20MB zijn.

## Scripts

| Commando | Wat het doet |
| --- | --- |
| `npm run dev` | Start API en web-app samen |
| `npm run build` | Productiebuild van server en web |
| `npm start` | Start alleen de gebouwde API |

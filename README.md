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
5. Voeg de kaart toe aan je collectie. Die staat lokaal in `data/collection.json`.

Tips voor betere herkenning: recht van boven, weinig glare op holo’s, collectornummer onderaan leesbaar. Kaarttaal (EN/FR/DE/ES/IT) stel je in via de selector bovenin.

## Scripts

| Commando | Wat het doet |
| --- | --- |
| `npm run dev` | Start API en web-app samen |
| `npm run build` | Productiebuild van server en web |
| `npm start` | Start alleen de gebouwde API |

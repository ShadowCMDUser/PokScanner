import { useEffect, useRef, useState } from "react";
import { cardArt, formatEur, scanCard, trendPrice } from "../api";
import type { CardCondition, Lang, ScanResponse, TcgdexCard } from "../types";

const CONDITIONS: { id: CardCondition; label: string }[] = [
  { id: "mint", label: "Mint" },
  { id: "nm", label: "Near Mint" },
  { id: "lp", label: "Light Play" },
  { id: "mp", label: "Moderate Play" },
  { id: "hp", label: "Heavily Played" },
  { id: "dmg", label: "Damaged" },
];

type Props = {
  lang: Lang;
  onAdd: (card: TcgdexCard, condition: CardCondition) => Promise<void>;
};

export function Scanner({ lang, onAdd }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [streamReady, setStreamReady] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [condition, setCondition] = useState<CardCondition>("nm");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let stream: MediaStream | undefined;
    const video = videoRef.current;

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      })
      .then((media) => {
        stream = media;
        if (video) {
          video.srcObject = media;
          void video.play();
          setStreamReady(true);
        }
      })
      .catch(() => {
        setError("Camera niet beschikbaar. Je kan ook een foto uploaden.");
      });

    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function runScan(blob: Blob, previewUrl: string) {
    setPreview(previewUrl);
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const scan = await scanCard(blob, lang);
      setResult(scan);
      setSelectedId(scan.bestMatch?.card.id ?? scan.matches[0]?.card.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function capture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), "image/jpeg", 0.92);
    });
    if (!blob) return;
    await runScan(blob, URL.createObjectURL(blob));
  }

  async function onFile(file: File) {
    await runScan(file, URL.createObjectURL(file));
  }

  const selected =
    result?.matches.find((match) => match.card.id === selectedId)?.card ??
    result?.bestMatch?.card ??
    null;

  return (
    <section className="hero">
      <div>
        <div className="viewfinder">
          {preview ? (
            <img className="preview" src={preview} alt="Gescande kaart" />
          ) : (
            <>
              <video ref={videoRef} playsInline muted />
              <div className="frame" />
            </>
          )}
        </div>
        <div className="controls">
          <button className="btn primary" onClick={() => void capture()} disabled={!streamReady || busy}>
            Scan kaart
          </button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
            Upload foto
          </button>
          {preview && (
            <button
              className="btn ghost"
              onClick={() => {
                setPreview(null);
                setResult(null);
                setSaved(false);
              }}
            >
              Opnieuw
            </button>
          )}
          <input
            ref={fileRef}
            className="hidden-input"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
        </div>
      </div>

      <div className="side">
        <div>
          <h2>Resultaat</h2>
          <p className="muted">
            OCR leest naam en nummer, daarna zoeken we de kaart in de TCGdex-catalogus.
          </p>
        </div>

        {busy && (
          <div className="scan-status">
            <div className="spin" />
            Kaart herkennen...
          </div>
        )}

        {error && <div className="error">{error}</div>}

        {result && selected && (
          <>
            {selected.image && (
              <img className="result-art" src={cardArt(selected.image)} alt={selected.name} />
            )}
            <div className="meta">
              <strong>{selected.name}</strong>
              <span className="muted">
                {selected.set?.name} · #{selected.localId}
                {selected.rarity ? ` · ${selected.rarity}` : ""}
              </span>
              <div className="types">
                {(selected.types ?? []).map((type) => (
                  <span className="chip" key={type}>
                    {type}
                  </span>
                ))}
              </div>
              <div className="price">{formatEur(trendPrice(selected))}</div>
              <span className="muted">Cardmarket trendprijs</span>
            </div>

            {result.ocr.nameCandidates.length > 0 && (
              <p className="muted">
                OCR: {result.ocr.nameCandidates[0]}
                {result.ocr.collectorNumber
                  ? ` · ${result.ocr.collectorNumber}${result.ocr.setTotal ? `/${result.ocr.setTotal}` : ""}`
                  : ""}
              </p>
            )}

            {result.matches.length > 1 && (
              <div className="matches">
                {result.matches.map((match) => (
                  <button
                    key={match.card.id}
                    className={`match-card ${match.card.id === selected.id ? "selected" : ""}`}
                    onClick={() => setSelectedId(match.card.id)}
                  >
                    <img src={cardArt(match.card.image, "low")} alt="" />
                    <span>
                      <strong>{match.card.name}</strong>
                      <br />
                      <span className="muted">
                        {match.card.set?.name} · {match.score}%
                      </span>
                    </span>
                    <span className="chip">{match.reasons[0] ?? "match"}</span>
                  </button>
                ))}
              </div>
            )}

            <label className="muted" htmlFor="condition">
              Conditie
            </label>
            <select
              id="condition"
              value={condition}
              onChange={(event) => setCondition(event.target.value as CardCondition)}
            >
              {CONDITIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>

            <button
              className="btn primary"
              disabled={saved}
              onClick={() => {
                void onAdd(selected, condition).then(() => setSaved(true));
              }}
            >
              {saved ? "Toegevoegd aan collectie" : "Zet in collectie"}
            </button>
          </>
        )}

        {result && !selected && !busy && (
          <div className="error">
            Geen betrouwbare match. Probeer dichterbij, met minder schittering, of zoek de
            kaart handmatig.
          </div>
        )}
      </div>
    </section>
  );
}

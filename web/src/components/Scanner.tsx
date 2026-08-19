import { useCallback, useEffect, useRef, useState } from "react";
import { cardArt, formatEur, scanCard, trendPrice } from "../api";
import { useScanAction } from "../ScanAction";
import { PokeballIcon } from "./Pokeball";
import type { CardCondition, Lang, OcrResult, ScanResponse, TcgdexCard } from "../types";

const CONDITIONS: { id: CardCondition; label: string }[] = [
  { id: "mint", label: "Mint" },
  { id: "nm", label: "NM" },
  { id: "lp", label: "LP" },
  { id: "mp", label: "MP" },
  { id: "hp", label: "HP" },
  { id: "dmg", label: "DMG" },
];

type Props = {
  lang: Lang;
  onAdd: (card: TcgdexCard, condition: CardCondition) => Promise<void>;
};

function toBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), "image/jpeg", 0.95);
  });
}

function readout(ocr: OcrResult) {
  const bits = [
    ocr.nameCandidates[0],
    ocr.hp ? `HP ${ocr.hp}` : null,
    ocr.evolvesFrom ? `van ${ocr.evolvesFrom}` : null,
    ocr.collectorNumber ? `#${ocr.collectorNumber}${ocr.setTotal ? `/${ocr.setTotal}` : ""}` : null,
    ocr.ability,
    ocr.attacks?.[0] ? `${ocr.attacks[0].name} ${ocr.attacks[0].damage ?? ""}`.trim() : null,
    ocr.illustrator,
  ].filter(Boolean);
  return bits.join(" · ");
}

export function Scanner({ lang, onAdd }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureCanvas = useRef<HTMLCanvasElement | null>(null);
  const langRef = useRef(lang);
  const { register } = useScanAction();

  const [streamReady, setStreamReady] = useState(false);
  const [camTick, setCamTick] = useState(0);
  const [hint, setHint] = useState<string | null>("Kaart in het kader, tik de pokéball onderaan");
  const [scanning, setScanning] = useState(false);
  const [needsCamera, setNeedsCamera] = useState(false);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [condition, setCondition] = useState<CardCondition>("nm");
  const [saved, setSaved] = useState(false);

  langRef.current = lang;

  useEffect(() => {
    let stream: MediaStream | undefined;
    let cancelled = false;
    const video = videoRef.current;
    setNeedsCamera(false);
    setStreamReady(false);

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      .then((media) => {
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        if (video) {
          video.srcObject = media;
          void video.play();
          setStreamReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setNeedsCamera(true);
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [camTick]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || scanning || video.readyState < 2 || !video.videoWidth) return;

    if (result) {
      setResult(null);
      setSaved(false);
      setSelectedId(null);
      setHint("Kaart in het kader, tik de pokéball onderaan");
      return;
    }

    captureCanvas.current ??= document.createElement("canvas");
    const canvas = captureCanvas.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    setScanning(true);
    setHint("Hele kaart uitlezen...");

    void toBlob(canvas)
      .then(async (blob) => {
        if (!blob) throw new Error("Kon geen foto maken");
        const scan = await scanCard(blob, langRef.current);
        if (!scan.matches.length || !scan.bestMatch) {
          setHint(
            scan.ocr.nameCandidates[0]
              ? `Gelezen: ${readout(scan.ocr)}. Nog geen catalogus-match.`
              : "Kon de tekst niet lezen. Houd de kaart stiller in het kader.",
          );
          return;
        }
        setResult(scan);
        setSelectedId(scan.bestMatch.card.id);
        setHint(null);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "";
        setHint(/timeout|abort/i.test(message) ? "Even geduld, tik opnieuw." : "Scan mislukt, tik opnieuw.");
      })
      .finally(() => {
        setScanning(false);
      });
  }, [result, scanning]);

  useEffect(() => {
    register({
      capture,
      scanning,
      busy: scanning || Boolean(result),
    });
    return () => register(null);
  }, [capture, register, result, scanning]);

  const selected =
    result?.matches.find((match) => match.card.id === selectedId)?.card ??
    result?.bestMatch?.card ??
    null;

  return (
    <section className="scanner">
      <div className={`viewfinder${needsCamera ? " needs-cam" : ""}`}>
        <video ref={videoRef} playsInline muted autoPlay />
        <div className="vignette" />
        {!result && !needsCamera && <div className="card-guide" />}

        {needsCamera && (
          <div className="cam-empty">
            <PokeballIcon className="login-ball" />
            <h2>Camera aanzetten</h2>
            <p className="muted">PokScanner heeft je camera nodig om kaarten te herkennen.</p>
            <button className="btn primary" onClick={() => setCamTick((tick) => tick + 1)}>
              Toegang geven
            </button>
          </div>
        )}

        {!result && !needsCamera && hint && (
          <div className="scan-hint">
            <PokeballIcon className="hint-ball" spin={scanning} />
            {hint}
          </div>
        )}
      </div>

      {result && selected && (
        <div className="picker">
          <div className="sheet-handle" />
          <div className="picker-top">
            <div>
              <h2>Is dit je kaart?</h2>
              <p className="muted">{readout(result.ocr) || "Tik de juiste foto"}</p>
            </div>
            <button
              className="btn ghost btn-sm"
              onClick={() => {
                setResult(null);
                setSaved(false);
                setSelectedId(null);
                setHint("Kaart in het kader, tik de pokéball onderaan");
              }}
            >
              Opnieuw
            </button>
          </div>

          <div className="picker-track">
            {(result.matches.length ? result.matches : result.bestMatch ? [result.bestMatch] : []).map(
              (match) => (
                <button
                  key={match.card.id}
                  className={`picker-card${match.card.id === selected.id ? " selected" : ""}`}
                  onClick={() => setSelectedId(match.card.id)}
                >
                  {match.card.image ? (
                    <img src={cardArt(match.card.image, "high")} alt={match.card.name} />
                  ) : (
                    <div className="picker-fallback">{match.card.name}</div>
                  )}
                  <strong>{match.card.name}</strong>
                  <span className="muted">
                    {match.card.set?.name} · #{match.card.localId}
                  </span>
                </button>
              ),
            )}
          </div>

          <div className="picker-footer">
            <div className="picker-chosen">
              <strong>{selected.name}</strong>
              <span className="price">{formatEur(trendPrice(selected))}</span>
            </div>
            <div className="sheet-actions">
              <select
                value={condition}
                onChange={(event) => setCondition(event.target.value as CardCondition)}
                aria-label="Conditie"
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
                {saved ? "Toegevoegd" : "Ja, toevoegen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

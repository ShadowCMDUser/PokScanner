import { useCallback, useEffect, useRef, useState } from "react";
import { cardArt, formatEur, scanCard, trendPrice } from "../api";
import { useScanAction } from "../ScanAction";
import { PokeballIcon } from "./Pokeball";
import type { CardCondition, Lang, ScanResponse, TcgdexCard } from "../types";

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

type ImageCaptureLike = {
  takePhoto: () => Promise<Blob>;
};

function fitCanvas(canvas: HTMLCanvasElement, width: number, height: number, maxSide = 1800) {
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  canvas.width = Math.max(8, Math.round(width * scale));
  canvas.height = Math.max(8, Math.round(height * scale));
  return canvas.getContext("2d");
}

async function captureScene(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  const stream = video.srcObject;
  if (stream instanceof MediaStream) {
    const track = stream.getVideoTracks()[0];
    const ImageCaptureCtor = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => ImageCaptureLike })
      .ImageCapture;
    if (track && ImageCaptureCtor) {
      try {
        const blob = await new ImageCaptureCtor(track).takePhoto();
        const bitmap = await createImageBitmap(blob);
        const ctx = fitCanvas(canvas, bitmap.width, bitmap.height);
        if (ctx) {
          ctx.imageSmoothingEnabled = canvas.width !== bitmap.width;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          bitmap.close();
          const photo = await toBlob(canvas);
          if (photo && photo.size > 20000) return photo;
        } else {
          bitmap.close();
        }
      } catch {
        // iOS and some browsers have no still-photo capture.
      }
    }
  }
  const ctx = fitCanvas(canvas, video.videoWidth, video.videoHeight);
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = canvas.width !== video.videoWidth;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return toBlob(canvas);
}

export function Scanner({ lang, onAdd }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const stampRef = useRef<HTMLSpanElement>(null);
  const captureCanvas = useRef<HTMLCanvasElement | null>(null);
  const langRef = useRef(lang);
  const { register } = useScanAction();

  const [camTick, setCamTick] = useState(0);
  const [hint, setHint] = useState<string | null>("Richt de camera op de kaart");
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

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
        audio: false,
      })
      .then((media) => {
        if (cancelled) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        const track = media.getVideoTracks()[0];
        void track
          ?.applyConstraints({
            advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet],
          })
          .catch(() => undefined);
        if (video) {
          video.srcObject = media;
          void video.play();
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
      setHint("Richt de camera op de kaart");
      return;
    }

    captureCanvas.current ??= document.createElement("canvas");
    const canvas = captureCanvas.current;

    setScanning(true);
    setHint("Kaart zoeken...");

    void captureScene(video, canvas)
      .then(async (blob) => {
        if (!blob) throw new Error("Kon geen foto maken");
        setHint("Nummer lezen...");
        const scan = await scanCard(blob, langRef.current);
        if (!scan.matches.length || !scan.bestMatch) {
          setHint("Geen match. Kaart stiller in beeld, met licht op het nummer.");
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
        {!result && !needsCamera && (
          <div className="card-guide" ref={guideRef}>
            <span className="stamp-spot" ref={stampRef} />
          </div>
        )}

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
              <p className="muted">Tik de juiste foto</p>
            </div>
            <button
              className="btn ghost btn-sm"
              onClick={() => {
                setResult(null);
                setSaved(false);
                setSelectedId(null);
                setHint("Richt de camera op de kaart");
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

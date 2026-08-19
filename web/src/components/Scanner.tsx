import { useEffect, useRef, useState } from "react";
import { cardArt, formatEur, scanCard, trendPrice } from "../api";
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

type Bounds = { x: number; y: number; w: number; h: number };

function drawVideo(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  crop?: Bounds,
) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  if (crop) {
    ctx.drawImage(
      video,
      video.videoWidth * crop.x,
      video.videoHeight * crop.y,
      video.videoWidth * crop.w,
      video.videoHeight * crop.h,
      0,
      0,
      width,
      height,
    );
  } else {
    ctx.drawImage(video, 0, 0, width, height);
  }
  return ctx;
}

function grayAt(data: Uint8ClampedArray, w: number, x: number, y: number) {
  const i = (y * w + x) * 4;
  return data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
}

function findCard(ctx: CanvasRenderingContext2D, w: number, h: number): Bounds | null {
  const { data } = ctx.getImageData(0, 0, w, h);
  const mag = new Float32Array(w * h);
  let maxMag = 0;

  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const gx = grayAt(data, w, x + 1, y) - grayAt(data, w, x - 1, y);
      const gy = grayAt(data, w, x, y + 1) - grayAt(data, w, x, y - 1);
      const value = Math.abs(gx) + Math.abs(gy);
      mag[y * w + x] = value;
      if (value > maxMag) maxMag = value;
    }
  }

  if (maxMag < 28) return null;

  const thresh = maxMag * 0.22;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let hits = 0;

  for (let y = 2; y < h - 2; y += 1) {
    for (let x = 2; x < w - 2; x += 1) {
      if (mag[y * w + x] < thresh) continue;
      hits += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  const boxW = maxX - minX;
  const boxH = maxY - minY;
  if (hits < 40 || boxW < w * 0.22 || boxH < h * 0.22) return null;

  const padX = boxW * 0.08;
  const padY = boxH * 0.06;
  const x = Math.max(0, minX - padX) / w;
  const y = Math.max(0, minY - padY) / h;
  const right = Math.min(w, maxX + padX) / w;
  const bottom = Math.min(h, maxY + padY) / h;
  return { x, y, w: right - x, h: bottom - y };
}

function frameStats(ctx: CanvasRenderingContext2D, w: number, h: number, prev: Uint8ClampedArray | null) {
  const { data } = ctx.getImageData(0, 0, w, h);
  const count = w * h;
  const next = new Uint8ClampedArray(count);
  let sum = 0;
  let sumSq = 0;
  let motion = 0;

  for (let i = 0; i < count; i += 1) {
    const p = i * 4;
    const gray = data[p] * 0.3 + data[p + 1] * 0.59 + data[p + 2] * 0.11;
    next[i] = gray;
    sum += gray;
    sumSq += gray * gray;
    if (prev) motion += Math.abs(gray - prev[i]);
  }

  return {
    variance: sumSq / count - (sum / count) ** 2,
    motion: prev ? motion / count : 999,
    next,
  };
}

function toBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), "image/jpeg", 0.92);
  });
}

function cardLike(bounds: Bounds, video: HTMLVideoElement) {
  const aspect = (bounds.w * video.videoWidth) / (bounds.h * video.videoHeight);
  return aspect > 0.58 && aspect < 0.86 && bounds.w > 0.34 && bounds.h > 0.34;
}

function isConfident(scan: ScanResponse) {
  const best = scan.bestMatch;
  if (!best || scan.ocr.nameCandidates.length === 0) return false;
  if (best.score >= 78) return true;
  if (best.score >= 64 && scan.ocr.collectorNumber) return true;
  return false;
}

export function Scanner({ lang, onAdd }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const langRef = useRef(lang);
  const busyRef = useRef(false);
  const cooldownRef = useRef(0);
  const prevFrameRef = useRef<Uint8ClampedArray | null>(null);
  const lastMatchRef = useRef<string | null>(null);
  const stableRef = useRef(0);
  const sampleCanvas = useRef<HTMLCanvasElement | null>(null);
  const captureCanvas = useRef<HTMLCanvasElement | null>(null);

  const [streamReady, setStreamReady] = useState(false);
  const [camTick, setCamTick] = useState(0);
  const [hint, setHint] = useState("Houd je kaart in beeld");
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

  useEffect(() => {
    if (!streamReady || result) return;

    sampleCanvas.current ??= document.createElement("canvas");
    captureCanvas.current ??= document.createElement("canvas");

    const timer = window.setInterval(() => {
      if (busyRef.current || Date.now() < cooldownRef.current) return;

      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;

      const sample = sampleCanvas.current!;
      const ctx = drawVideo(video, sample, 90, 160);
      if (!ctx) return;

      const stats = frameStats(ctx, 90, 160, prevFrameRef.current);
      prevFrameRef.current = stats.next;

      if (stats.variance < 280) {
        stableRef.current = 0;
        setHint("Houd je kaart in beeld");
        return;
      }
      if (stats.motion > 16) {
        stableRef.current = 0;
        setHint("Houd even stil...");
        return;
      }

      const card = findCard(ctx, 90, 160);
      if (!card) {
        stableRef.current = 0;
        setHint("Houd je kaart in beeld");
        return;
      }

      stableRef.current += 1;
      if (stableRef.current < 3) {
        setHint("Kaart gezien...");
        return;
      }

      busyRef.current = true;
      setScanning(true);
      setHint("Kaart herkennen...");

      const capture = captureCanvas.current!;
      const useCrop = cardLike(card, video);
      const maxW = 1280;
      if (useCrop) {
        const width = Math.min(maxW, Math.round(video.videoWidth * card.w));
        const height = Math.max(
          160,
          Math.round(width * ((card.h * video.videoHeight) / Math.max(card.w * video.videoWidth, 1))),
        );
        drawVideo(video, capture, width, height, card);
      } else {
        const scale = Math.min(1, maxW / video.videoWidth);
        drawVideo(
          video,
          capture,
          Math.round(video.videoWidth * scale),
          Math.round(video.videoHeight * scale),
        );
      }

      void toBlob(capture)
        .then(async (blob) => {
          if (!blob) return;
          const scan = await scanCard(blob, langRef.current);
          const best = scan.bestMatch;
          if (!best) {
            lastMatchRef.current = null;
            cooldownRef.current = Date.now() + 500;
            setHint("Nog geen match, houd de kaart stil...");
            return;
          }

          const sameAsLast = lastMatchRef.current === best.card.id;
          lastMatchRef.current = best.card.id;

          if (isConfident(scan) || (sameAsLast && best.score >= 58)) {
            setResult(scan);
            setSelectedId(best.card.id);
            setHint(null);
            return;
          }

          cooldownRef.current = Date.now() + 350;
          setHint("Bijna... houd nog even stil");
        })
        .catch(() => {
          cooldownRef.current = Date.now() + 900;
          setHint("Opnieuw proberen...");
        })
        .finally(() => {
          busyRef.current = false;
          setScanning(false);
          stableRef.current = 0;
        });
    }, 400);

    return () => window.clearInterval(timer);
  }, [streamReady, result]);

  function reset() {
    setResult(null);
    setSaved(false);
    setSelectedId(null);
    setHint("Houd je kaart in beeld");
    cooldownRef.current = Date.now() + 800;
    prevFrameRef.current = null;
    lastMatchRef.current = null;
    stableRef.current = 0;
  }

  const selected =
    result?.matches.find((match) => match.card.id === selectedId)?.card ??
    result?.bestMatch?.card ??
    null;

  return (
    <section className="scanner">
      <div className={`viewfinder${needsCamera ? " needs-cam" : ""}`}>
        <video ref={videoRef} playsInline muted autoPlay />
        <div className="vignette" />

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
        <div className="sheet">
          <div className="sheet-handle" />
          <div className="sheet-head">
            {selected.image && (
              <img className="sheet-art" src={cardArt(selected.image, "low")} alt="" />
            )}
            <div className="sheet-meta">
              <strong>{selected.name}</strong>
              <span className="muted">
                {selected.set?.name} · #{selected.localId}
              </span>
              <span className="price">{formatEur(trendPrice(selected))}</span>
            </div>
            <button className="btn ghost btn-sm" onClick={reset}>
              Opnieuw
            </button>
          </div>

          {result.matches.length > 1 && (
            <div className="match-row">
              {result.matches.map((match) => (
                <button
                  key={match.card.id}
                  className={`match-pill ${match.card.id === selected.id ? "selected" : ""}`}
                  onClick={() => setSelectedId(match.card.id)}
                >
                  {match.card.name}
                  <span>{match.score}%</span>
                </button>
              ))}
            </div>
          )}

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
              {saved ? "Toegevoegd" : "In collectie"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

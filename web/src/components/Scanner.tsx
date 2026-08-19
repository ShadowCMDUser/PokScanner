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

const CARD_ASPECT = 63 / 88;

function snapToCard(bounds: Bounds, frameW: number, frameH: number): Bounds {
  const pxW = bounds.w * frameW;
  const pxH = bounds.h * frameH;
  const cx = bounds.x * frameW + pxW / 2;
  const cy = bounds.y * frameH + pxH / 2;
  let w = pxW;
  let h = pxH;
  if (w / Math.max(h, 1) > CARD_ASPECT) h = w / CARD_ASPECT;
  else w = h * CARD_ASPECT;

  const scale = Math.min(1, (frameW - 2) / w, (frameH - 2) / h);
  w *= scale;
  h *= scale;
  const x = Math.max(0, Math.min(cx - w / 2, frameW - w));
  const y = Math.max(0, Math.min(cy - h / 2, frameH - h));
  return { x: x / frameW, y: y / frameH, w: w / frameW, h: h / frameH };
}

function boxFromHits(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  w: number,
  h: number,
  padX: number,
  padY: number,
): Bounds {
  const x = Math.max(0, minX - padX) / w;
  const y = Math.max(0, minY - padY) / h;
  const right = Math.min(w, maxX + padX) / w;
  const bottom = Math.min(h, maxY + padY) / h;
  return { x, y, w: right - x, h: bottom - y };
}

function findBrightCard(data: Uint8ClampedArray, w: number, h: number): Bounds | null {
  let sum = 0;
  const count = w * h;
  for (let i = 0; i < data.length; i += 4) {
    sum += data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
  }
  const thresh = Math.min(210, sum / count + 22);
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let hits = 0;

  for (let y = 2; y < h - 2; y += 1) {
    for (let x = 2; x < w - 2; x += 1) {
      if (grayAt(data, w, x, y) < thresh) continue;
      hits += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  const boxW = maxX - minX;
  const boxH = maxY - minY;
  if (hits < count * 0.1 || boxW < w * 0.28 || boxH < h * 0.28) return null;
  return boxFromHits(minX, minY, maxX, maxY, w, h, boxW * 0.04, boxH * 0.03);
}

function findEdgeCard(data: Uint8ClampedArray, w: number, h: number): Bounds | null {
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
  return boxFromHits(minX, minY, maxX, maxY, w, h, boxW * 0.06, boxH * 0.05);
}

function closerToCard(a: Bounds, b: Bounds | null) {
  if (!b) return a;
  const score = (box: Bounds) => Math.abs(Math.log(box.w / Math.max(box.h, 0.01) / CARD_ASPECT));
  return score(a) <= score(b) ? a : b;
}

function findCard(ctx: CanvasRenderingContext2D, w: number, h: number): Bounds | null {
  const { data } = ctx.getImageData(0, 0, w, h);
  const bright = findBrightCard(data, w, h);
  const edges = findEdgeCard(data, w, h);
  if (!bright && !edges) return null;
  const found = closerToCard(bright ?? edges!, edges);
  const snapped = snapToCard(found, w, h);
  if (snapped.w < 0.28 || snapped.h < 0.34) return null;
  return snapped;
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

function isConfident(scan: ScanResponse) {
  return (scan.bestMatch?.score ?? 0) >= 70;
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
  const [hint, setHint] = useState<string | null>("Houd je kaart stil in beeld");
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
      const ctx = drawVideo(video, sample, 108, 192);
      if (!ctx) return;

      const stats = frameStats(ctx, 108, 192, prevFrameRef.current);
      prevFrameRef.current = stats.next;

      if (stats.variance < 280) {
        stableRef.current = 0;
        setHint("Houd je kaart stil in beeld");
        return;
      }
      if (stats.motion > 16) {
        stableRef.current = 0;
        setHint("Houd even stil...");
        return;
      }

      const card = findCard(ctx, 108, 192);
      if (!card) {
        stableRef.current = 0;
        setHint("Houd je kaart stil in beeld");
        return;
      }

      stableRef.current += 1;
      if (stableRef.current < 3) {
        setHint("Kaart gezien...");
        return;
      }

      busyRef.current = true;
      setScanning(true);
      setHint("Kaart herkennen... even geduld");

      const capture = captureCanvas.current!;
      const maxSide = 1280;
      const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
      drawVideo(
        video,
        capture,
        Math.round(video.videoWidth * scale),
        Math.round(video.videoHeight * scale),
      );

      void toBlob(capture)
        .then(async (blob) => {
          if (!blob) return;
          const scan = await scanCard(blob, langRef.current);
          const best = scan.bestMatch;
          if (!best || !scan.matches.length) {
            lastMatchRef.current = null;
            cooldownRef.current = Date.now() + 1400;
            setHint("Geen match, houd de kaart vlak in beeld...");
            return;
          }

          lastMatchRef.current = best.card.id;
          if (isConfident(scan) || scan.matches.length > 0) {
            setResult(scan);
            setSelectedId(best.card.id);
            setHint(null);
          }
        })
        .catch((error: unknown) => {
          cooldownRef.current = Date.now() + 2500;
          const message = error instanceof Error ? error.message : "";
          setHint(
            /timeout|abort/i.test(message)
              ? "Scanner start op, nog eens stilhouden..."
              : "Opnieuw proberen...",
          );
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
    setHint("Houd je kaart stil in beeld");
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
        <div className="picker">
          <div className="sheet-handle" />
          <div className="picker-top">
            <div>
              <h2>Welke kaart?</h2>
              <p className="muted">
                {result.bestMatch
                  ? `${result.bestMatch.score}% visuele match · tik de juiste foto`
                  : "Tik de juiste foto"}
              </p>
            </div>
            <button className="btn ghost btn-sm" onClick={reset}>
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
                {saved ? "Toegevoegd" : "In collectie"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

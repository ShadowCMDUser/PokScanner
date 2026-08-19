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

function coverSourceRect(video: HTMLVideoElement, guide: HTMLElement) {
  const v = video.getBoundingClientRect();
  const g = guide.getBoundingClientRect();
  const videoRatio = video.videoWidth / video.videoHeight;
  const elemRatio = v.width / Math.max(v.height, 1);
  let renderW = v.width;
  let renderH = v.height;
  let offsetX = 0;
  let offsetY = 0;
  if (videoRatio > elemRatio) {
    renderH = v.height;
    renderW = renderH * videoRatio;
    offsetX = (v.width - renderW) / 2;
  } else {
    renderW = v.width;
    renderH = renderW / videoRatio;
    offsetY = (v.height - renderH) / 2;
  }
  const scaleX = video.videoWidth / renderW;
  const scaleY = video.videoHeight / renderH;
  const pad = 0.03;
  let sx = (g.left - v.left - offsetX) * scaleX;
  let sy = (g.top - v.top - offsetY) * scaleY;
  let sw = g.width * scaleX;
  let sh = g.height * scaleY;
  sx -= sw * pad;
  sy -= sh * pad;
  sw += sw * pad * 2;
  sh += sh * pad * 2;
  sx = Math.max(0, Math.min(sx, video.videoWidth - 8));
  sy = Math.max(0, Math.min(sy, video.videoHeight - 8));
  sw = Math.max(8, Math.min(sw, video.videoWidth - sx));
  sh = Math.max(8, Math.min(sh, video.videoHeight - sy));
  return { sx, sy, sw, sh };
}

export function Scanner({ lang, onAdd }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const captureCanvas = useRef<HTMLCanvasElement | null>(null);
  const langRef = useRef(lang);
  const { register } = useScanAction();

  const [streamReady, setStreamReady] = useState(false);
  const [camTick, setCamTick] = useState(0);
  const [hint, setHint] = useState<string | null>("Kaart in het kader, nummer linksonder zichtbaar");
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
    const guide = guideRef.current;
    if (!video || scanning || video.readyState < 2 || !video.videoWidth) return;

    if (result) {
      setResult(null);
      setSaved(false);
      setSelectedId(null);
      setHint("Kaart in het kader, nummer linksonder zichtbaar");
      return;
    }

    captureCanvas.current ??= document.createElement("canvas");
    const canvas = captureCanvas.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (guide) {
      const { sx, sy, sw, sh } = coverSourceRect(video, guide);
      canvas.width = Math.max(720, Math.round(sw));
      canvas.height = Math.round((canvas.width * sh) / sw);
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    } else {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
    }

    setScanning(true);
    setHint("Kaart herkennen...");

    void toBlob(canvas)
      .then(async (blob) => {
        if (!blob) throw new Error("Kon geen foto maken");
        const scan = await scanCard(blob, langRef.current);
        if (!scan.matches.length || !scan.bestMatch) {
          setHint("Geen match. Houd de kaart stiller in het kader.");
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
        {!result && !needsCamera && <div className="card-guide" ref={guideRef} />}

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
                setHint("Kaart in het kader, nummer linksonder zichtbaar");
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

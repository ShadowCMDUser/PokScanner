import { useCallback, useEffect, useRef, useState } from "react";
import { cardArt, formatEur, scanCard, trendPrice } from "../api";
import { useScanAction } from "../ScanAction";
import { PokeballIcon } from "./Pokeball";
import { CARD_CONDITIONS, type CardCondition, type Lang, type ScanResponse, type TcgdexCard } from "../types";

const CONDITION_LABELS: Record<CardCondition, string> = {
  mint: "Mint",
  nm: "NM",
  lp: "LP",
  mp: "MP",
  hp: "HP",
  dmg: "DMG",
};

const CONDITIONS = CARD_CONDITIONS.map((id) => ({ id, label: CONDITION_LABELS[id] }));

const IDLE_HINT = "Kaart in het kader, nummer linksonder";

type Props = {
  lang: Lang;
  onAdd: (card: TcgdexCard, condition: CardCondition) => Promise<void>;
};

type CameraIssue = "denied" | "missing" | "unavailable";

const CAMERA_COPY: Record<CameraIssue, { title: string; body: string; action: string }> = {
  denied: {
    title: "Camera geblokkeerd",
    body: "Sta cameratoegang toe in je browserinstellingen en probeer opnieuw.",
    action: "Opnieuw proberen",
  },
  missing: {
    title: "Geen camera gevonden",
    body: "Sluit een camera aan of gebruik een toestel met camera.",
    action: "Opnieuw zoeken",
  },
  unavailable: {
    title: "Camera aanzetten",
    body: "PokScanner heeft je camera nodig om kaarten te herkennen.",
    action: "Toegang geven",
  },
};

type CropRect = { sx: number; sy: number; sw: number; sh: number };

type ImageCaptureInstance = {
  takePhoto: () => Promise<Blob>;
};

type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureInstance;

function toBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), "image/jpeg", 0.95);
  });
}

function resetCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.width = 1;
  canvas.height = 1;
}

function coverSourceRect(video: HTMLVideoElement, guide: HTMLElement, pad = 0.04): CropRect {
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

function mapPreviewRectToPhoto(
  videoWidth: number,
  videoHeight: number,
  photoWidth: number,
  photoHeight: number,
  rect: CropRect,
): CropRect {
  const videoAR = videoWidth / Math.max(videoHeight, 1);
  const photoAR = photoWidth / Math.max(photoHeight, 1);
  let usedW = photoWidth;
  let usedH = photoHeight;
  let offX = 0;
  let offY = 0;
  if (photoAR > videoAR) {
    usedH = photoHeight;
    usedW = photoHeight * videoAR;
    offX = (photoWidth - usedW) / 2;
  } else {
    usedW = photoWidth;
    usedH = photoWidth / videoAR;
    offY = (photoHeight - usedH) / 2;
  }
  const scale = usedW / Math.max(videoWidth, 1);
  return {
    sx: offX + rect.sx * scale,
    sy: offY + rect.sy * scale,
    sw: rect.sw * scale,
    sh: rect.sh * scale,
  };
}

function drawCrop(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  rect: CropRect,
  maxWidth = 2000,
) {
  if (sourceWidth < 8 || sourceHeight < 8) return false;
  const sx = Math.max(0, Math.min(rect.sx, sourceWidth - 8));
  const sy = Math.max(0, Math.min(rect.sy, sourceHeight - 8));
  const sw = Math.max(8, Math.min(rect.sw, sourceWidth - sx));
  const sh = Math.max(8, Math.min(rect.sh, sourceHeight - sy));
  const scale = sw > maxWidth ? maxWidth / sw : 1;
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx || canvas.width < 8 || canvas.height < 8) return false;
  ctx.imageSmoothingEnabled = scale !== 1;
  ctx.imageSmoothingQuality = "high";
  try {
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  } catch {
    return false;
  }
  return true;
}

function imageCaptureFor(track: MediaStreamTrack | undefined): ImageCaptureInstance | null {
  if (!track || track.readyState !== "live") return null;
  if (!("ImageCapture" in window)) return null;
  const Ctor = (window as Window & { ImageCapture?: ImageCaptureCtor }).ImageCapture;
  if (!Ctor) return null;
  try {
    return new Ctor(track);
  } catch {
    return null;
  }
}

function videoFrameReady(video: HTMLVideoElement) {
  return (
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0
  );
}

async function captureFromVideo(video: HTMLVideoElement, canvas: HTMLCanvasElement, preview: CropRect) {
  if (!videoFrameReady(video)) return null;
  if (!drawCrop(canvas, video, video.videoWidth, video.videoHeight, preview)) return null;
  return toBlob(canvas);
}

async function captureCard(
  video: HTMLVideoElement,
  guide: HTMLElement,
  stamp: HTMLElement | null,
  canvas: HTMLCanvasElement,
) {
  const target = stamp ?? guide;
  const preview = coverSourceRect(video, target, stamp ? 0.1 : 0.02);
  const stream = video.srcObject;
  const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : undefined;
  const still = imageCaptureFor(track);

  if (still) {
    try {
      const blob = await still.takePhoto();
      const bitmap = await createImageBitmap(blob);
      try {
        if (bitmap.width >= 8 && bitmap.height >= 8) {
          const mapped = mapPreviewRectToPhoto(
            video.videoWidth,
            video.videoHeight,
            bitmap.width,
            bitmap.height,
            preview,
          );
          if (drawCrop(canvas, bitmap, bitmap.width, bitmap.height, mapped)) {
            const photo = await toBlob(canvas);
            if (photo && photo.size > 4000) return photo;
          }
        }
      } finally {
        bitmap.close();
      }
    } catch {
      // iOS and some browsers have no still-photo capture.
    }
  }

  return captureFromVideo(video, canvas, preview);
}

function cameraIssueFrom(error: unknown): CameraIssue {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "missing";
  return "unavailable";
}

export function Scanner({ lang, onAdd }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const stampRef = useRef<HTMLSpanElement>(null);
  const captureCanvas = useRef<HTMLCanvasElement | null>(null);
  const aliveRef = useRef(true);
  const scanAbort = useRef<AbortController | null>(null);
  const langRef = useRef(lang);
  const { register } = useScanAction();

  const [camTick, setCamTick] = useState(0);
  const [hint, setHint] = useState<string | null>(IDLE_HINT);
  const [scanning, setScanning] = useState(false);
  const [streamReady, setStreamReady] = useState(false);
  const [cameraIssue, setCameraIssue] = useState<CameraIssue | null>(null);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [condition, setCondition] = useState<CardCondition>("nm");
  const [saved, setSaved] = useState(false);

  langRef.current = lang;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      scanAbort.current?.abort();
      if (captureCanvas.current) resetCanvas(captureCanvas.current);
    };
  }, []);

  const markVideoReady = useCallback(() => {
    const video = videoRef.current;
    if (video && videoFrameReady(video)) setStreamReady(true);
  }, []);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let cancelled = false;
    const video = videoRef.current;
    setCameraIssue(null);
    setStreamReady(false);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraIssue("unavailable");
      return;
    }

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
        if (cancelled || !aliveRef.current) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        const track = media.getVideoTracks()[0];
        void track
          ?.applyConstraints({
            advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
          })
          .catch(() => undefined);
        if (video) {
          video.srcObject = media;
          void video.play().catch(() => undefined);
          if (videoFrameReady(video)) setStreamReady(true);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && aliveRef.current) setCameraIssue(cameraIssueFrom(error));
      });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
  }, [camTick]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onReady = () => markVideoReady();
    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("resize", onReady);
    return () => {
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("resize", onReady);
    };
  }, [camTick, markVideoReady]);

  const resetScan = useCallback(() => {
    setResult(null);
    setSaved(false);
    setSelectedId(null);
    setHint(IDLE_HINT);
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const guide = guideRef.current;
    if (!video || scanning || !streamReady || !videoFrameReady(video) || !guide) return;

    if (result) {
      resetScan();
      return;
    }

    captureCanvas.current ??= document.createElement("canvas");
    const canvas = captureCanvas.current;
    scanAbort.current?.abort();
    const abort = new AbortController();
    scanAbort.current = abort;

    setScanning(true);
    setHint("Nummer lezen...");

    void captureCard(video, guide, stampRef.current, canvas)
      .then(async (blob) => {
        resetCanvas(canvas);
        if (!aliveRef.current || abort.signal.aborted) return;
        if (!blob) throw new Error("Kon geen foto maken");
        const scan = await scanCard(blob, langRef.current, abort.signal);
        if (!aliveRef.current || abort.signal.aborted) return;
        if (!scan.matches.length || !scan.bestMatch) {
          setHint("Geen match. Kaart stiller in het kader, licht op het nummer.");
          return;
        }
        setResult(scan);
        setSelectedId(scan.bestMatch.card.id);
        setHint(null);
      })
      .catch((error: unknown) => {
        if (!aliveRef.current || abort.signal.aborted) return;
        const name = error instanceof DOMException ? error.name : "";
        const message = error instanceof Error ? error.message : "";
        if (name === "AbortError") return;
        setHint(/timeout|abort/i.test(message) ? "Even geduld, tik opnieuw." : "Scan mislukt, tik opnieuw.");
      })
      .finally(() => {
        resetCanvas(canvas);
        if (aliveRef.current && !abort.signal.aborted) setScanning(false);
      });
  }, [resetScan, result, scanning, streamReady]);

  const captureRef = useRef(capture);
  captureRef.current = capture;
  const runCapture = useCallback(() => captureRef.current(), []);

  useEffect(() => {
    register({
      capture: runCapture,
      scanning,
      busy: scanning || !streamReady,
    });
  }, [register, runCapture, scanning, streamReady]);

  useEffect(() => () => register(null), [register]);

  const selected =
    result?.matches.find((match) => match.card.id === selectedId)?.card ??
    result?.bestMatch?.card ??
    null;

  const shownHint = !streamReady && !cameraIssue && !scanning ? "Camera starten..." : hint;
  const cameraCopy = cameraIssue ? CAMERA_COPY[cameraIssue] : null;

  return (
    <section className="scanner">
      <div className={`viewfinder${cameraIssue ? " needs-cam" : ""}`}>
        <video ref={videoRef} playsInline muted autoPlay onLoadedMetadata={markVideoReady} />
        <div className="vignette" />
        {!result && !cameraIssue && (
          <div className="card-guide" ref={guideRef}>
            <span className="stamp-spot" ref={stampRef} />
          </div>
        )}

        {cameraCopy && (
          <div className="cam-empty">
            <PokeballIcon className="login-ball" />
            <h2>{cameraCopy.title}</h2>
            <p className="muted">{cameraCopy.body}</p>
            <button className="btn primary" onClick={() => setCamTick((tick) => tick + 1)}>
              {cameraCopy.action}
            </button>
          </div>
        )}

        {!result && !cameraIssue && shownHint && (
          <div className="scan-hint">
            <PokeballIcon className="hint-ball" spin={scanning} />
            {shownHint}
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
            <button className="btn ghost btn-sm" onClick={resetScan}>
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
                  void onAdd(selected, condition).then(() => {
                    if (aliveRef.current) setSaved(true);
                  });
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

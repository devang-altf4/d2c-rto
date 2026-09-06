'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GATE_MESSAGE, LM, MIN_FRAMES, aggregate, gate, hemPosition, measureFrame,
  type AggregateResult, type FrameMeasurement, type GateFailure, type Landmark,
} from '@rto/core';
import { COLOURWAYS, drawGarment, loadPlate, plateReady } from './garment';

/**
 * L1 capture. Runs entirely in the browser — the frames never leave the device,
 * which is both the correct design for body images and a line worth saying out
 * loud in the demo.
 *
 * Flow: height -> camera -> guide overlay until the pose passes the gate ->
 * sample ~2s -> median -> recommendation.
 *
 * The guide overlay is not decoration. Asking her to fill the outline forces
 * her far enough back that her whole body is in frame (which the height
 * reference depends on) and reduces the perspective distortion you get up
 * close. One overlay, two problems.
 *
 * The garment is drawn from the first frame a pose is found, before the gate
 * passes, because seeing it on herself is what makes her stay long enough to be
 * measured. It is a preview and does not feed the measurement — that comes from
 * worldLandmarks and her height, and is unchanged by anything drawn here.
 */

type Phase = 'height' | 'camera' | 'result';

export function PoseCapture({
  garmentLengthCm = 112,
  onResult,
}: {
  garmentLengthCm?: number;
  onResult?: (r: AggregateResult & { heightCm: number; frame?: string }) => void;
}) {
  const [phase, setPhase] = useState<Phase>('height');
  const [heightCm, setHeightCm] = useState(162);
  const [status, setStatus] = useState<GateFailure | null>('NO_POSE');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<AggregateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [colour, setColour] = useState(COLOURWAYS[0].id);
  // read inside the animation loop, which closes over the first render's state
  const colourRef = useRef(colour);
  colourRef.current = colour;

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const samples = useRef<FrameMeasurement[]>([]);
  const raf = useRef<number>(0);
  const landmarkerRef = useRef<any>(null);

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    const s = videoRef.current?.srcObject as MediaStream | undefined;
    s?.getTracks().forEach((t) => t.stop());
  }, []);

  useEffect(() => stop, [stop]);

  async function start() {
    setPhase('camera');
    setError(null);
    samples.current = [];
    setProgress(0);

    try {
      // Loaded here, not on page render. The model is several megabytes and no
      // product page should pay for it before she taps.
      // the plate is small next to the model; start it early, do not await it
      void loadPlate();

      const vision = await import('@mediapipe/tasks-vision');
      const fileset = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
      landmarkerRef.current = await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: '/mediapipe/pose_landmarker_lite.task', delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: 1,
      });

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 } },
      });
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      loop();
    } catch (e) {
      setError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Camera access was blocked. You can enter your size in another brand instead.'
          : 'Could not start the camera. Try the other-brand option below.',
      );
    }
  }

  function loop() {
    const v = videoRef.current;
    const c = canvasRef.current;
    const lm = landmarkerRef.current;
    if (!v || !c || !lm || v.readyState < 2) {
      raf.current = requestAnimationFrame(loop);
      return;
    }

    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);

    const res = lm.detectForVideo(v, performance.now());
    const image: Landmark[] = res.landmarks?.[0] ?? [];
    const world: Landmark[] = res.worldLandmarks?.[0] ?? [];

    const fail = gate(image, world);
    setStatus(fail);

    // Garment first, so the guide and the hem line read on top of it.
    const dressed =
      plateReady() && image.length
        ? drawGarment(ctx, image, c.width, c.height, colourRef.current)
        : null;

    if (!dressed) drawGuide(ctx, c.width, c.height, fail);

    if (!fail) {
      samples.current.push(measureFrame(world, heightCm));
      setProgress(Math.min(1, samples.current.length / MIN_FRAMES));
      if (!dressed) drawSkeleton(ctx, image, c.width, c.height);

      if (samples.current.length >= MIN_FRAMES) {
        const agg = aggregate(samples.current);
        if (agg) {
          drawHem(ctx, image, world, agg, garmentLengthCm, c.width, c.height);
          // Grab the frame BEFORE stopping the stream. This is the photo the
          // render step uses, so she is never asked to upload one of herself —
          // and it is the same pose the measurement came from.
          setResult(agg);
          setPhase('result');
          onResult?.({ ...agg, heightCm, frame: grabFrame(v) });
          stop();
          return;
        }
      }
    } else {
      // A rejected frame invalidates the run — she moved, so start clean rather
      // than blending two different poses into one measurement.
      if (samples.current.length && samples.current.length < MIN_FRAMES) {
        samples.current = [];
        setProgress(0);
      }
    }

    raf.current = requestAnimationFrame(loop);
  }

  /** Current video frame as a JPEG data URL, sized for the render endpoint. */
  function grabFrame(v: HTMLVideoElement): string | undefined {
    try {
      const long = Math.max(v.videoWidth, v.videoHeight);
      const k = Math.min(1, 1024 / long);
      const off = document.createElement('canvas');
      off.width = Math.round(v.videoWidth * k);
      off.height = Math.round(v.videoHeight * k);
      const g = off.getContext('2d');
      if (!g) return undefined;
      g.drawImage(v, 0, 0, off.width, off.height);
      return off.toDataURL('image/jpeg', 0.86);
    } catch {
      return undefined;   // tainted canvas or no context; the upload path still works
    }
  }

  // ------------------------------------------------------------------ draw

  function drawGuide(ctx: CanvasRenderingContext2D, w: number, h: number, fail: GateFailure | null) {
    const cx = w / 2;
    const top = h * 0.04;
    const bottom = h * 0.96;
    const bodyW = h * 0.17;

    ctx.save();
    ctx.strokeStyle = fail ? 'rgba(255,255,255,.55)' : 'rgba(90,200,160,.95)';
    ctx.lineWidth = Math.max(2, w / 260);
    ctx.setLineDash(fail ? [10, 10] : []);

    // Head, then a tapered torso-and-legs outline. Deliberately loose — it is
    // a framing target, not a shape she has to match.
    const headR = (bottom - top) * 0.055;
    ctx.beginPath();
    ctx.arc(cx, top + headR, headR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx - bodyW * 0.5, top + headR * 2.3);
    ctx.lineTo(cx - bodyW * 0.62, top + (bottom - top) * 0.45);
    ctx.lineTo(cx - bodyW * 0.4, bottom);
    ctx.moveTo(cx + bodyW * 0.5, top + headR * 2.3);
    ctx.lineTo(cx + bodyW * 0.62, top + (bottom - top) * 0.45);
    ctx.lineTo(cx + bodyW * 0.4, bottom);
    ctx.stroke();
    ctx.restore();
  }

  function drawSkeleton(ctx: CanvasRenderingContext2D, l: Landmark[], w: number, h: number) {
    const pairs = [
      [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
      [LM.LEFT_SHOULDER, LM.LEFT_HIP],
      [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
      [LM.LEFT_HIP, LM.RIGHT_HIP],
    ];
    ctx.save();
    ctx.strokeStyle = 'rgba(90,200,160,.9)';
    ctx.lineWidth = Math.max(2, w / 300);
    for (const [a, b] of pairs) {
      ctx.beginPath();
      ctx.moveTo(l[a].x * w, l[a].y * h);
      ctx.lineTo(l[b].x * w, l[b].y * h);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Where the hem actually lands on her. For kurtas, length is a real driver. */
  function drawHem(
    ctx: CanvasRenderingContext2D, image: Landmark[], world: Landmark[],
    agg: AggregateResult, lengthCm: number, w: number, h: number,
  ) {
    const y = hemPosition(image, lengthCm, agg.scale, world) * h;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,196,80,.95)';
    ctx.lineWidth = Math.max(2, w / 300);
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.moveTo(w * 0.16, y);
    ctx.lineTo(w * 0.84, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,196,80,.95)';
    ctx.font = `600 ${Math.round(w / 28)}px system-ui, sans-serif`;
    ctx.fillText(`hem · ${lengthCm}cm`, w * 0.16, y - w / 48);
    ctx.restore();
  }

  // ------------------------------------------------------------------- ui

  if (phase === 'height') {
    return (
      <div style={panel}>
        <h2 style={h2}>How tall are you?</h2>
        <p style={note}>
          A camera alone can&apos;t tell a smaller person standing close from a taller one
          standing back. Your height is what turns the picture into centimetres.
        </p>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '18px 0 6px' }}>
          <span style={{ fontSize: 38, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {heightCm}
          </span>
          <span style={{ color: 'var(--muted)' }}>cm</span>
        </div>
        <input
          type="range" min={140} max={190} value={heightCm}
          onChange={(e) => setHeightCm(+e.target.value)}
          style={{ width: '100%', accentColor: 'var(--accent)' }}
        />
        <button onClick={start} style={primary}>Open camera</button>
        <p style={{ ...note, marginTop: 14 }}>
          Everything runs on your phone. <strong>The picture never leaves your device.</strong>
        </p>
      </div>
    );
  }

  if (phase === 'result' && result) {
    return (
      <div style={panel}>
        <h2 style={h2}>Measured</h2>
        <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px 16px', margin: '16px 0' }}>
          <dt style={dt}>Chest</dt>
          <dd style={dd}>{result.bodyChestCm.toFixed(0)} ± {result.bandCm.toFixed(0)} cm</dd>
          <dt style={dt}>Chest breadth</dt>
          <dd style={dd}>{result.chestBreadthCm.toFixed(1)} cm</dd>
          <dt style={dt}>Chest depth</dt>
          <dd style={{ ...dd, opacity: 0.7 }}>{result.chestDepthCm.toFixed(1)} cm est.</dd>
          <dt style={dt}>Shoulders</dt>
          <dd style={dd}>{result.shoulderCm.toFixed(1)} cm</dd>
          <dt style={dt}>Torso</dt>
          <dd style={dd}>{result.torsoCm.toFixed(0)} cm</dd>
          <dt style={dt}>Confidence</dt>
          <dd style={dd}>{Math.round(result.confidence * 100)}%</dd>
        </dl>
        <p style={note}>
          Estimated from {result.frames} frames. Breadth is measured; <strong>depth is not</strong> —
          a camera in front of you cannot see front-to-back, so that figure comes from a
          population model of your build. That assumption is most of the ±{result.bandCm.toFixed(0)}cm,
          and holding still for longer will not shrink it. The garment side of the model decides
          between the sizes the band leaves open.
        </p>
      </div>
    );
  }

  return (
    <div style={{ ...panel, padding: 0, overflow: 'hidden' }}>
      <div style={{ position: 'relative', background: '#000', aspectRatio: '9 / 16' }}>
        <video
          ref={videoRef} playsInline muted
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            transform: 'scaleX(-1)', pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute', left: 0, right: 0, top: 0, display: 'flex',
            justifyContent: 'center', gap: 8, padding: '12px 10px',
            background: 'linear-gradient(rgba(0,0,0,.55), transparent)',
          }}
        >
          {COLOURWAYS.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-label={c.name}
              aria-pressed={colour === c.id}
              onClick={() => setColour(c.id)}
              style={{
                width: 28, height: 28, borderRadius: '50%', padding: 0, cursor: 'pointer',
                background: c.swatch,
                border: colour === c.id ? '2px solid #fff' : '1.5px solid rgba(255,255,255,.45)',
                boxShadow: colour === c.id ? '0 0 0 2px rgba(255,255,255,.35)' : 'none',
              }}
            />
          ))}
        </div>

        <div
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 16px 18px',
            background: 'linear-gradient(transparent, rgba(0,0,0,.78))', color: '#fff',
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }}>
            {error ?? (status ? GATE_MESSAGE[status] : 'Hold still')}
          </div>
          <div style={{ fontSize: 11.5, opacity: 0.72, marginBottom: 8 }}>
            Garment shown is a preview — tap a colour to change it
          </div>
          <div style={{ height: 4, background: 'rgba(255,255,255,.22)', borderRadius: 2 }}>
            <div
              style={{
                width: `${progress * 100}%`, height: '100%', borderRadius: 2,
                background: '#5ac8a0', transition: 'width .15s linear',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const panel: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--rule)',
  borderRadius: 6, padding: 22, maxWidth: 420, margin: '0 auto',
};
const h2: React.CSSProperties = { margin: '0 0 6px', fontSize: 19, letterSpacing: '-0.01em' };
const note: React.CSSProperties = { margin: 0, fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.5 };
const dt: React.CSSProperties = { color: 'var(--muted)', fontSize: 14 };
const dd: React.CSSProperties = {
  margin: 0, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
  fontFamily: 'var(--mono)', fontSize: 14,
};
const primary: React.CSSProperties = {
  width: '100%', marginTop: 18, padding: '12px 16px', font: 'inherit', fontWeight: 600,
  background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer',
};

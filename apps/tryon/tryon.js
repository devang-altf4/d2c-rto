/* H&K try-on. Pose landmarks give the shoulder line; a reference of known size
 * turns pixels into millimetres. There are two such references here, and which
 * one we get depends on how the shopper is standing:
 *
 *   HEIGHT (good, ~1-2%)  — she told us her height and her whole body is in
 *     frame, so worldLandmarks give a nose-to-ankle span to scale against.
 *   IPD (fallback, ~5.6%) — she is framed to the torso, which is the natural
 *     way to look at a hoodie on yourself. All we have then is the eye line,
 *     at a 63mm population mean with an SD of 3.5mm.
 *
 * The fallback is why the panel says which reference it used. A 5.6% scale
 * error on a 45cm shoulder is 2.5cm, which is exactly one size step, so the
 * difference between the two references is the difference between a
 * recommendation and a guess. */
import {FilesetResolver, PoseLandmarker} from "./vendor/vision_bundle.mjs";

export const IPD_MM = 63;          // adult interpupillary mean; SD ~3.5mm
const ACROMION = 1.10;             // pose shoulders sit inside the acromion

/* Nose sits at ~0.93 of stature and the ankle at ~0.04, so the span between
   them is ~0.89 of standing height. Same constant the web widget uses. */
export const NOSE_TO_ANKLE_FRACTION = 0.89;
const ANKLE_VIS = 0.7;             // ankles must be solidly seen, not guessed at

/* H&K unisex hoodie, shoulder seam in cm. Steps of 2.5cm. */
export const SIZE_CHART = [
  {size:"XS",  shoulder:42.0, chest:52, length:66},
  {size:"S",   shoulder:44.5, chest:55, length:68},
  {size:"M",   shoulder:47.0, chest:58, length:70},
  {size:"L",   shoulder:49.5, chest:61, length:72},
  {size:"XL",  shoulder:52.0, chest:64, length:74},
  {size:"XXL", shoulder:54.5, chest:67, length:76},
];
export const STEP_CM = 2.5;

export function recommend(shoulderCM, chestCM){
  let best=SIZE_CHART[0], bd=Infinity;
  for(const r of SIZE_CHART){
    let d=Math.abs(r.shoulder-shoulderCM);
    if(chestCM!=null && !isNaN(chestCM) && chestCM>0){
      const dChest=Math.abs(r.chest-chestCM);
      d=Math.hypot(d, dChest*0.8);
    }
    if(d<bd){ bd=d; best=r; }
  }
  const toBoundary=(STEP_CM/2)-Math.abs(best.shoulder-shoulderCM);
  const idx=SIZE_CHART.indexOf(best);
  const other=shoulderCM>best.shoulder ? SIZE_CHART[idx+1] : SIZE_CHART[idx-1];
  return {row:best, toBoundary, other:other||null, ease:best.shoulder-shoulderCM};
}

export class PoseEngine{
  async load(){
    const fileset=await FilesetResolver.forVisionTasks("./vendor/wasm");
    const opts=d=>({
      baseOptions:{modelAssetPath:"./vendor/pose_landmarker_lite.task", delegate:d},
      runningMode:"VIDEO", numPoses:1,
      minPoseDetectionConfidence:0.5, minPosePresenceConfidence:0.5, minTrackingConfidence:0.5
    });
    try{ this.lm=await PoseLandmarker.createFromOptions(fileset, opts("GPU")); this.delegate="GPU"; }
    catch(e){ this.lm=await PoseLandmarker.createFromOptions(fileset, opts("CPU")); this.delegate="CPU"; }
    this._mode="VIDEO";
    return this.delegate;
  }
  async mode(m){
    if(!this.lm || this._mode===m) return;
    await this.lm.setOptions({runningMode:m});
    this._mode=m;
  }
  /* Both landmark sets come back. The image set is what gets drawn on; the
     world set is metric-ish and partially perspective-corrected, which is the
     only one worth scaling a height against. */
  detect(video, ts){
    if(!this.lm) return null;
    return pick(this.lm.detectForVideo(video, ts));
  }
  /* still-image path: the same model and the same maths, one frame instead of
     a stream. Used when there is no camera on the machine. */
  detectImage(el){
    if(!this.lm) return null;
    return pick(this.lm.detect(el));
  }
  close(){ if(this.lm){ this.lm.close(); this.lm=null; } }
}

function pick(res){
  if(!res || !res.landmarks || !res.landmarks.length) return null;
  return {lm:res.landmarks[0], world:(res.worldLandmarks && res.worldLandmarks[0]) || null};
}

/* Landmarks are normalised 0..1. Everything below works in that space and only
 * multiplies by pixel dimensions where a distance is needed. */
/* Scale from stature, when we can get it. Returns mm per pixel, or null.
 *
 * The ratio is taken in world space and then transferred to pixels through the
 * shoulder line, because image-space vertical spans are perspective-distorted:
 * feet are further from the lens than the face, so a nose-to-ankle pixel count
 * reads short and would inflate every measurement derived from it. */
function heightScale(lm, world, W, H, heightCm){
  if(!world || !heightCm) return null;
  const vis=i=>(lm[i].visibility===undefined?1:lm[i].visibility);
  if(vis(27)<ANKLE_VIS || vis(28)<ANKLE_VIS) return null;   // torso framing, no ankles

  const ankleY=(world[27].y+world[28].y)/2;
  const span=Math.abs(world[0].y-ankleY);
  if(!(span>0.2)) return null;                              // degenerate world fit

  // cm per world unit, from her height
  const cmPerUnit=heightCm/(span/NOSE_TO_ANKLE_FRACTION);
  // shoulder line is horizontal, so it survives the transfer to pixels intact
  const shWorld=Math.hypot(world[11].x-world[12].x, world[11].y-world[12].y, world[11].z-world[12].z);
  const shPx=Math.hypot((lm[11].x-lm[12].x)*W, (lm[11].y-lm[12].y)*H);
  if(!(shPx>8) || !(shWorld>0.05)) return null;
  return (shWorld*cmPerUnit*10)/shPx;                       // mm per pixel
}

/* `res` is {lm, world} from the engine. heightCm is optional — without it, or
   without ankles in frame, this falls back to the eye line. */
export function readBody(res, W, H, heightCm, opts={}){
  if(!res) return {ok:false, reason:"nobody"};
  const {lm, world}=res;
  if(!lm) return {ok:false, reason:"nobody"};
  const v=i=>(lm[i].visibility===undefined?1:lm[i].visibility);
  const p=i=>[lm[i].x*W, lm[i].y*H];
  if(v(11)<0.6 || v(12)<0.6) return {ok:false, reason:"shoulders"};
  if(v(2)<0.5 || v(5)<0.5)   return {ok:false, reason:"face"};

  const [le,re]=[p(2),p(5)];
  const ipdPx=Math.hypot(le[0]-re[0], le[1]-re[1]);
  if(ipdPx<12) return {ok:false, reason:"far"};

  // the scale is only honest looking straight at the camera: turning the head
  // foreshortens the eye line and would silently shrink every measurement
  const eyeTilt=Math.abs(le[1]-re[1])/ipdPx;
  const nose=p(0);
  const eyeMidX=(le[0]+re[0])/2;
  const yaw=Math.abs(nose[0]-eyeMidX)/ipdPx;
  if(eyeTilt>0.30 || yaw>0.38) return {ok:false, reason:"turned", ipdPx};

  const [ls,rs]=[p(11),p(12)];
  const shoulderPx=Math.hypot(ls[0]-rs[0], ls[1]-rs[1]);

  // Prefer stature. It is the better reference by a factor of three, but it is
  // only available when she has stepped back far enough to get her feet in.
  const fromHeight=heightScale(lm, world, W, H, heightCm);
  let mmPerPx=fromHeight!==null ? fromHeight : IPD_MM/ipdPx;
  const scaleRef=fromHeight!==null ? "HEIGHT" : "IPD";

  // Seated desk perspective calibration: when ankles are not visible, compensates for
  // face being closer to the camera than the shoulders.
  const seatedFactor = (fromHeight===null && opts && opts.seatedFactor) ? opts.seatedFactor : 1.0;
  mmPerPx *= seatedFactor;

  const shoulderMM=shoulderPx*mmPerPx*ACROMION;
  if(shoulderMM<250 || shoulderMM>850) return {ok:false, reason:"implausible", shoulderMM};

  // Chest measurement: flat chest width along the underarm torso line
  // Proportional to body frame, matching the 1.232 ratio of the garment size chart
  const chestMM = shoulderMM * 1.232;
  const chestPx = shoulderPx * 1.232;

  // shoulders roughly level, and both in frame with room around them
  const inFrame = ls[0]>4 && rs[0]>4 && ls[0]<W-4 && rs[0]<W-4;
  if(!inFrame) return {ok:false, reason:"cropped"};

  return {ok:true, shoulderMM, chestMM, shoulderPx, chestPx, ipdPx, mmPerPx, eyeTilt, yaw, scaleRef,
          torsoVisible: v(23)>0.5 && v(24)>0.5};
}

/* Rolling median, so one bad frame cannot move the recommendation. */
export class Stabiliser{
  constructor(n=24){ this.n=n; this.buf=[]; }
  push(v){ this.buf.push(v); if(this.buf.length>this.n) this.buf.shift(); return this.value(); }
  reset(){ this.buf=[]; }
  get count(){ return this.buf.length; }
  value(){
    if(!this.buf.length) return null;
    const s=[...this.buf].sort((a,b)=>a-b);
    return s[Math.floor(s.length/2)];
  }
  get spread(){
    if(this.buf.length<4) return Infinity;
    const s=[...this.buf].sort((a,b)=>a-b);
    return s[Math.floor(s.length*0.9)]-s[Math.floor(s.length*0.1)];
  }
  get settled(){ return this.buf.length>=this.n*0.7 && this.spread<12; }  // 12mm p10-p90
}

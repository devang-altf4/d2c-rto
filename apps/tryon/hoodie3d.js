/* The 3D try-on: a rigged hoodie composited over the camera feed.
 *
 * WHAT THIS IS AND IS NOT
 *
 * It is a composite, not a simulation. There is no depth buffer for the
 * wearer, so the garment cannot be occluded by her own hands and does not
 * drape, wrinkle or collide. What it does that the flat plate cannot: turn
 * with the torso, follow the elbows and wrists, and — the part that matters —
 * carry the true dimensions of one SKU, so switching M to L visibly changes
 * the garment rather than the zoom.
 *
 * SPACE
 *
 * Everything is done in overlay-canvas pixels with an orthographic camera, so
 * the render lines up with the video exactly and no field-of-view has to be
 * guessed. Depth comes from MediaPipe's worldLandmarks, converted to pixels
 * through the same shoulder-width ratio that sets the horizontal scale, so x,
 * y and z stay in one consistent unit.
 */
import * as THREE from './vendor/three/three.module.js';
import { GLTFLoader } from './vendor/three/GLTFLoader.js';
import { specFromRow, buildHoodie, BONE, BONES } from './garment3d.js';
import { colourway } from './hoodie.js';

/* MediaPipe indices we pose from. */
const L = { SH: 11, EL: 13, WR: 15 };
const R = { SH: 12, EL: 14, WR: 16 };
const HIP_L = 23, HIP_R = 24;

/* The sleeves are modelled hanging straight down, so this is the direction a
   bone points before it is rotated onto the wearer. */
const BIND_DIR = new THREE.Vector3(0, -1, 0);

export class Hoodie3D {
  constructor() {
    this.ready = false;
    this.failed = null;
    this.size = null;
    /* Exponential smoothing for live video: 0 snaps (exact, and what the
       geometry tests run with); the page sets ~0.35 so the cloth stops
       shivering without lagging a real move. */
    this.smoothing = 0;
    this._sm = null;
    this._scratch = { q: new THREE.Quaternion(), q2: new THREE.Quaternion(), m: new THREE.Matrix4() };
  }

  /** Forget the last frame so the next pose() snaps instead of slewing in. */
  resetSmoothing() {
    this._sm = null;
  }

  /** Build the renderer against a canvas that sits on top of the video. */
  async init(canvas) {
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas, alpha: true, antialias: true, premultipliedAlpha: false,
      });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;

      this.scene = new THREE.Scene();
      // Orthographic: the overlay is a 2D composite, and a perspective camera
      // would need the phone's real FOV to line up. Frustum is set per frame.
      this.camera = new THREE.OrthographicCamera(0, 1, 0, -1, -10000, 10000);

      // Flat-ish studio light. A strong key would read as a different garment
      // from the product photography two panels away.
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa0a6, 2.1));
      const key = new THREE.DirectionalLight(0xffffff, 1.15);
      key.position.set(-0.4, 0.8, 1);
      this.scene.add(key);

      // The garment lives under a root whose transform IS the torso pose.
      this.root = new THREE.Group();
      this.scene.add(this.root);

      const buf = await fetch('./assets/hoodie.glb').then((r) => {
        if (!r.ok) throw new Error(`hoodie.glb ${r.status}`);
        return r.arrayBuffer();
      });
      const gltf = await new Promise((res, rej) =>
        new GLTFLoader().parse(buf, '', res, rej));

      gltf.scene.traverse((o) => { if (o.isSkinnedMesh) this.mesh = o; });
      if (!this.mesh) throw new Error('hoodie.glb has no skinned mesh');

      this.mesh.frustumCulled = false;       // we move it every frame
      this.material = new THREE.MeshStandardMaterial({
        color: 0xe4e6e7, roughness: 0.88, metalness: 0.0, side: THREE.DoubleSide,
      });
      this.mesh.material = this.material;

      // Bind by INDEX, not name: glTF node names lose their dots on import
      // ("upperArm.L" arrives as "upperArmL"), and index order is the skin's
      // joint order, which is guaranteed.
      this.bones = this.mesh.skeleton.bones;
      if (this.bones.length !== BONES.length)
        throw new Error(`rig mismatch: ${this.bones.length} bones, expected ${BONES.length}`);

      this.root.add(gltf.scene);
      this.ready = true;
      return true;
    } catch (e) {
      this.failed = e.message || String(e);
      return false;
    }
  }

  /** Re-loft the mesh to a different SKU. Positions only — the rig is unchanged. */
  setSize(row) {
    if (!this.ready || !row || this.size === row.size) return;
    const spec = specFromRow(row);
    const built = buildHoodie(spec);
    const attr = this.mesh.geometry.attributes.position;
    if (attr.array.length !== built.position.length) {
      this.failed = 'geometry does not match the generator; re-export hoodie.glb';
      return;
    }
    attr.array.set(built.position);
    attr.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.spec = spec;
    this.size = row.size;
  }

  setColour(id) {
    if (!this.ready) return;
    this.material.color.set(colourway(id).base);
  }

  /** Wipe the canvas. Without this a refused pose leaves the last good frame
      hanging on screen, which reads as the garment sticking to nothing. */
  clear() {
    if (this.ready) this.renderer.clear();
    this.resetSmoothing();
  }

  /**
   * Pose and draw one frame.
   *
   * `lm` are MIRRORED image landmarks (matching what the 2D painter uses so
   * both overlays agree), `world` the raw worldLandmarks, `vw`/`vh` the video
   * pixel size, and `fit` the cover-crop transform the overlay canvas uses.
   * `shoulderCm` is the measured body shoulder — it sets how many pixels a
   * centimetre of garment is worth, which is what ties the render to the
   * measurement rather than to the zoom level.
   */
  draw(lm, world, vw, vh, fit, shoulderCm) {
    if (!this.pose(lm, world, vw, vh, fit, shoulderCm)) return false;
    const { width, height } = fit;
    if (this.renderer.domElement.width !== width || this.renderer.domElement.height !== height)
      this.renderer.setSize(width, height, false);
    this.camera.left = 0; this.camera.right = width;
    this.camera.top = 0; this.camera.bottom = -height;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    return true;
  }

  /**
   * Everything except the draw call: landmarks in, root transform and bone
   * rotations out. Split from draw() so the geometry can be checked without a
   * WebGL context — the arithmetic here is where a mirrored axis or a botched
   * quaternion hides, and none of it needs a GPU to verify.
   */
  pose(lm, world, vw, vh, fit, shoulderCm) {
    if (!this.spec || !this.bones) return false;
    const { s, ox, oy } = fit;

    // ---- landmarks into overlay pixels, with depth ------------------------
    // Horizontal scale is honest (image pixels); depth is only as good as
    // worldLandmarks, which is enough to turn the torso and not enough to
    // measure with. It is never used for a measurement.
    const sx = (i) => lm[i].x * vw * s + ox;
    const sy = (i) => lm[i].y * vh * s + oy;

    const shPxL = sx(L.SH), shPxR = sx(R.SH);
    const shoulderPx = Math.hypot(shPxL - shPxR, sy(L.SH) - sy(R.SH));
    if (!(shoulderPx > 8)) return false;

    let zScale = 0;
    if (world && world[L.SH] && world[R.SH]) {
      const wDist = Math.hypot(
        world[L.SH].x - world[R.SH].x,
        world[L.SH].y - world[R.SH].y,
        world[L.SH].z - world[R.SH].z);
      // Mirrored view: worldLandmark x is flipped with the image, and so is z's
      // sign relationship to it. Only the magnitude is used for the ratio.
      if (wDist > 0.05) zScale = shoulderPx / wDist;
    }
    const sz = (i) => (zScale && world[i] ? -world[i].z * zScale : 0);

    const P = (i) => new THREE.Vector3(sx(i), -sy(i), sz(i));   // screen y is down

    const pShL = P(L.SH), pShR = P(R.SH);
    const shoulderMid = pShL.clone().add(pShR).multiplyScalar(0.5);
    const hipMid = P(HIP_L).clone().add(P(HIP_R)).multiplyScalar(0.5);

    // ---- torso basis ------------------------------------------------------
    const yAxis = shoulderMid.clone().sub(hipMid);
    if (yAxis.lengthSq() < 1) return false;
    yAxis.normalize();
    const xAxis = pShL.clone().sub(pShR).normalize();          // +x = wearer's left
    const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
    if (zAxis.lengthSq() < 0.5) return false;                  // degenerate pose
    xAxis.crossVectors(yAxis, zAxis).normalize();              // re-orthogonalise

    const { m, q } = this._scratch;
    m.makeBasis(xAxis, yAxis, zAxis);
    q.setFromRotationMatrix(m);

    // ---- scale: centimetres of garment to pixels --------------------------
    // Anchored on the MEASURED shoulder, so a garment 2.5cm wider than the
    // body is drawn 2.5cm wider. Scaling to the on-screen shoulder instead
    // would silently resize the garment to fit whoever is standing there,
    // which is the exact lie this whole feature exists to avoid.
    const pxPerCm = shoulderPx / Math.max(20, shoulderCm);

    // Exponential ease toward this frame's measurement. The root already
    // holds last frame's smoothed pose, so lerping from it IS the filter;
    // the first frame after (re)acquire always snaps.
    const A = Math.min(1, Math.max(0, +this.smoothing || 0));
    const ease = A > 0 && !!this._sm;
    if (ease) {
      this.root.position.lerp(shoulderMid, A);
      this.root.quaternion.slerp(q, A);
      const s0 = this.root.scale.x;
      this.root.scale.setScalar(s0 + (pxPerCm - s0) * A);
    } else {
      this.root.position.copy(shoulderMid);
      this.root.quaternion.copy(q);
      this.root.scale.setScalar(pxPerCm);
      this._sm = { init: true };
    }

    // ---- arms -------------------------------------------------------------
    // Directions are taken into the torso frame, because that is the space the
    // bones live in once the root carries the torso rotation.
    const inv = q.clone().invert();
    const toLocal = (a, b) => b.clone().sub(a).applyQuaternion(inv).normalize();

    this._poseArm(BONE['upperArm.L'], BONE['foreArm.L'],
      toLocal(P(L.SH), P(L.EL)), toLocal(P(L.EL), P(L.WR)), ease, A);
    this._poseArm(BONE['upperArm.R'], BONE['foreArm.R'],
      toLocal(P(R.SH), P(R.EL)), toLocal(P(R.EL), P(R.WR)), ease, A);

    // Hips bone follows the torso's own bend, so the hem swings with a lean
    // instead of staying square to the shoulders.
    const spineDir = hipMid.clone().sub(shoulderMid).applyQuaternion(inv).normalize();
    const hips = this.bones[BONE.hips];
    this._scratch.q2.setFromUnitVectors(BIND_DIR, spineDir);
    if (ease) hips.quaternion.slerp(this._scratch.q2, A);
    else hips.quaternion.copy(this._scratch.q2);

    this.lastPose = { shoulderMid, hipMid, xAxis, yAxis, zAxis, pxPerCm, shoulderPx };
    return true;
  }

  /** Rotate one arm's two bones onto a measured elbow and wrist. */
  _poseArm(upperIdx, foreIdx, upperDir, foreDir, ease = false, A = 0) {
    const upper = this.bones[upperIdx], fore = this.bones[foreIdx];
    if (upperDir.lengthSq() > 0.5) {
      this._scratch.q.setFromUnitVectors(BIND_DIR, upperDir);
      if (ease) upper.quaternion.slerp(this._scratch.q, A);
      else upper.quaternion.copy(this._scratch.q);
      if (foreDir.lengthSq() > 0.5) {
        // The forearm is a child, so its target has to be expressed relative
        // to wherever the upper arm ended up.
        const rel = foreDir.clone().applyQuaternion(upper.quaternion.clone().invert());
        this._scratch.q.setFromUnitVectors(BIND_DIR, rel.normalize());
        if (ease) fore.quaternion.slerp(this._scratch.q, A);
        else fore.quaternion.copy(this._scratch.q);
      }
    }
  }

  dispose() {
    if (!this.renderer) return;
    this.mesh?.geometry.dispose();
    this.material?.dispose();
    this.renderer.dispose();
    this.ready = false;
  }
}

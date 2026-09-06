/* H&K hoodie renderer. One garment geometry, drawn two ways: as a flat-lay for
 * the product shot, and warped onto a person's shoulders for the try-on. All
 * coordinates are normalised to shoulder width, so both share the same shape. */

export const COLOURWAYS = [
  {id:"offwhite", name:"Off white",  photo:"offwhite", base:"#E4E6E7", rib:"#D2D5D6", shade:"#B7BBBD", ink:"#1B1B1B"},
  {id:"black",    name:"Black",      photo:"black",    base:"#1B1B1B", rib:"#111111", shade:"#000000", ink:"#FFFFFF"},
  {id:"ecru",     name:"Ecru",       photo:"ecru",     base:"#D9CEB9", rib:"#C8BCA5", shade:"#AFA48C", ink:"#1B1B1B"},
  {id:"cobalt",   name:"Cobalt",     photo:"cobalt",   base:"#3E5F96", rib:"#35527F", shade:"#2A4166", ink:"#FFFFFF"},
  {id:"clay",     name:"Clay",       photo:"clay",     base:"#A9705A", rib:"#95614D", shade:"#774C3B", ink:"#FFFFFF"},
  {id:"greymarl", name:"Grey marl",  photo:"greymarl", base:"#C4C7C9", rib:"#B0B4B6", shade:"#95999B", ink:"#1B1B1B"},
];
export const colourway = id => COLOURWAYS.find(c=>c.id===id) || COLOURWAYS[0];

/* ---- geometry, in shoulder-width units. y=0 is the shoulder line. ---- */
function bodyPath(g, hemY){
  g.beginPath();
  g.moveTo(-0.50, 0.00);
  g.bezierCurveTo(-0.545, 0.16, -0.545, 0.34, -0.525, 0.50);   // chest
  g.bezierCurveTo(-0.512, 0.72, -0.500, 0.92, -0.492, hemY);   // waist
  g.quadraticCurveTo(0.00, hemY+0.055, 0.492, hemY);           // curved hem
  g.bezierCurveTo(0.500, 0.92, 0.512, 0.72, 0.525, 0.50);
  g.bezierCurveTo(0.545, 0.34, 0.545, 0.16, 0.50, 0.00);
  g.bezierCurveTo(0.40, -0.020, 0.29, -0.030, 0.195, -0.025);  // right shoulder seam
  g.quadraticCurveTo(0.00, 0.075, -0.195, -0.025);             // neck scoop
  g.bezierCurveTo(-0.29, -0.030, -0.40, -0.020, -0.50, 0.00);
  g.closePath();
}
function roundRect(g,x,y,w,h,r){
  g.beginPath();
  g.moveTo(x+r,y); g.lineTo(x+w-r,y); g.quadraticCurveTo(x+w,y,x+w,y+r);
  g.lineTo(x+w,y+h-r); g.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  g.lineTo(x+r,y+h); g.quadraticCurveTo(x,y+h,x,y+h-r);
  g.lineTo(x,y+r); g.quadraticCurveTo(x,y,x+r,y); g.closePath();
}

/* hood sits behind the shoulders, so it is painted before the body */
function hood(g,c){
  g.fillStyle=c.shade;
  g.beginPath();
  g.moveTo(-0.335, 0.10);
  g.bezierCurveTo(-0.375,-0.26, -0.215,-0.50, 0.000,-0.50);
  g.bezierCurveTo( 0.215,-0.50,  0.375,-0.26, 0.335, 0.10);
  g.closePath(); g.fill();
  g.fillStyle=c.base;                                  // outer shell
  g.beginPath();
  g.moveTo(-0.335, 0.10);
  g.bezierCurveTo(-0.368,-0.24, -0.212,-0.465, 0.000,-0.465);
  g.bezierCurveTo( 0.212,-0.465, 0.368,-0.24, 0.335, 0.10);
  g.closePath(); g.fill();
  g.fillStyle=c.shade; g.globalAlpha=0.92;              // the opening reads as depth
  g.beginPath();
  g.moveTo(-0.215, 0.09);
  g.bezierCurveTo(-0.240,-0.16, -0.130,-0.315, 0.000,-0.315);
  g.bezierCurveTo( 0.130,-0.315, 0.240,-0.16, 0.215, 0.09);
  g.closePath(); g.fill(); g.globalAlpha=1;
}
/* Try-on draws on top of the camera feed, so an up-hood would paint over the
 * wearer's face. This is the hood lying down on the upper back: a low mound
 * behind the neck that never reaches above the chin. */
function hoodDown(g,c){
  g.fillStyle=c.shade;
  g.beginPath();
  g.moveTo(-0.245, 0.20);
  g.bezierCurveTo(-0.258,-0.01, -0.150,-0.125, 0.000,-0.125);
  g.bezierCurveTo( 0.150,-0.125, 0.258,-0.01, 0.245, 0.20);
  g.closePath(); g.fill();
  g.fillStyle=c.base;
  g.beginPath();
  g.moveTo(-0.196, 0.20);
  g.bezierCurveTo(-0.205, 0.02, -0.118,-0.078, 0.000,-0.078);
  g.bezierCurveTo( 0.118,-0.078, 0.205, 0.02, 0.196, 0.20);
  g.closePath(); g.fill();
}
function sleeve(g,c,pts,wShoulder,wWrist){
  g.lineCap="round"; g.lineJoin="round"; g.strokeStyle=c.base;
  for(let i=0;i<pts.length-1;i++){
    const t=i/Math.max(1,pts.length-1);
    g.lineWidth=wShoulder+(wWrist-wShoulder)*t;
    g.beginPath(); g.moveTo(pts[i][0],pts[i][1]); g.lineTo(pts[i+1][0],pts[i+1][1]); g.stroke();
  }
  // cuff: a ribbed band across the sleeve end, not along it
  const last=pts[pts.length-1], prev=pts[pts.length-2];
  const ang=Math.atan2(last[1]-prev[1], last[0]-prev[0]);
  g.save();
  g.translate(last[0],last[1]); g.rotate(ang);
  roundRect(g,-0.095,-wWrist/2,0.095,wWrist,wWrist*0.22);
  g.fillStyle=c.rib; g.fill();
  g.restore();
}

function torso(g,c,hemY){
  bodyPath(g,hemY); g.fillStyle=c.base; g.fill();
  const side=g.createLinearGradient(-0.545,0,0.545,0);
  side.addColorStop(0,"rgba(0,0,0,.22)"); side.addColorStop(.26,"rgba(0,0,0,0)");
  side.addColorStop(.74,"rgba(0,0,0,0)"); side.addColorStop(1,"rgba(0,0,0,.22)");
  bodyPath(g,hemY); g.fillStyle=side; g.fill();
  const top=g.createLinearGradient(0,-0.03,0,0.34);      // shadow cast by the hood
  top.addColorStop(0,"rgba(0,0,0,.26)"); top.addColorStop(1,"rgba(0,0,0,0)");
  bodyPath(g,hemY); g.fillStyle=top; g.fill();
  g.save(); bodyPath(g,hemY); g.clip();                  // hem rib
  g.fillStyle=c.rib; g.fillRect(-0.6,hemY-0.075,1.2,0.22); g.restore();
  const pk=hemY-0.50;                                    // kangaroo pocket
  roundRect(g,-0.315,pk,0.63,0.30,0.045);
  g.fillStyle="rgba(0,0,0,.09)"; g.fill();
  g.strokeStyle="rgba(0,0,0,.20)"; g.lineWidth=0.007; g.stroke();
  g.beginPath(); g.moveTo(-0.315,pk+0.045); g.lineTo(-0.245,pk);
  g.moveTo(0.315,pk+0.045); g.lineTo(0.245,pk); g.stroke();
  g.beginPath();                                         // neck rib
  g.moveTo(-0.205,-0.030); g.quadraticCurveTo(0.00,0.090, 0.205,-0.030);
  g.strokeStyle=c.rib; g.lineWidth=0.055; g.lineCap="round"; g.stroke();
  g.strokeStyle=c.rib; g.lineWidth=0.017;                // drawstrings
  g.beginPath(); g.moveTo(-0.075,0.045); g.lineTo(-0.095,0.245); g.stroke();
  g.beginPath(); g.moveTo( 0.075,0.045); g.lineTo( 0.105,0.235); g.stroke();
  g.fillStyle=c.shade;
  [[-0.095,0.245],[0.105,0.235]].forEach(p=>{ g.beginPath(); g.arc(p[0],p[1],0.017,0,7); g.fill(); });
}

/* ---- product shot: flat lay, arms angled out ---- */
export function drawFlat(canvas, colourId, opts={}){
  const c=colourway(colourId), g=canvas.getContext("2d");
  const W=canvas.width, H=canvas.height;
  g.clearRect(0,0,W,H);
  if(opts.background){ g.fillStyle=opts.background; g.fillRect(0,0,W,H); }
  const SPAN_X=2.26, SPAN_Y=1.94;               // arm span, and hood top to hem
  const S=Math.min(W/SPAN_X, H/SPAN_Y);
  g.save();
  g.translate(W/2, H/2 - S*0.31);               // centre on the garment, not the box
  g.scale(S,S);
  g.lineJoin="round";
  hood(g,c);
  sleeve(g,c,[[-0.430,0.055],[-0.690,0.480],[-0.830,0.925]],0.335,0.185);
  sleeve(g,c,[[ 0.430,0.055],[ 0.690,0.480],[ 0.830,0.925]],0.335,0.185);
  torso(g,c,1.14);
  g.restore();
}

/* ---- try-on: anchored to detected shoulders, sleeves follow the arms ---- */
export function drawOnBody(g, lm, W, H, colourId, opts={}){
  const c=colourway(colourId);
  const P = i => [lm[i].x*W, lm[i].y*H];
  const vis = i => (lm[i].visibility===undefined ? 1 : lm[i].visibility);
  const [ls,rs]=[P(11),P(12)];
  const shoulderPx=Math.hypot(ls[0]-rs[0], ls[1]-rs[1]);
  if(shoulderPx<20) return null;
  const mid=[(ls[0]+rs[0])/2,(ls[1]+rs[1])/2];
  const ang=Math.atan2(ls[1]-rs[1], ls[0]-rs[0]);

  // torso length from hips when they are in frame, else a proportional fallback
  let torsoLen;
  if(vis(23)>0.5 && vis(24)>0.5){
    const hip=[(P(23)[0]+P(24)[0])/2,(P(23)[1]+P(24)[1])/2];
    torsoLen=Math.hypot(hip[0]-mid[0],hip[1]-mid[1])*1.30;
  } else torsoLen=shoulderPx*1.42;

  // garment is cut a little wider than the body
  const S=shoulderPx*(opts.ease||1.16);
  const yScale=torsoLen/S;

  g.save();
  g.translate(mid[0],mid[1]);
  g.rotate(ang);
  g.save();
  g.scale(S,S);
  g.lineJoin="round";
  hoodDown(g,c);
  g.restore();

  // sleeves live in unrotated screen space so they can track the real arms
  g.restore();
  const toLocal=p=>{
    const dx=p[0]-mid[0], dy=p[1]-mid[1];
    return [(dx*Math.cos(-ang)-dy*Math.sin(-ang))/S, (dx*Math.sin(-ang)+dy*Math.cos(-ang))/S];
  };
  g.save();
  g.translate(mid[0],mid[1]); g.rotate(ang); g.scale(S,S);
  g.lineJoin="round";
  const arm=(sh,el,wr,vEl,vWr)=>{
    const pts=[sh];
    if(vEl>0.4) pts.push(toLocal(el));
    if(vEl>0.4 && vWr>0.4) pts.push(toLocal(wr));
    if(pts.length===1) pts.push([sh[0]*1.93, 0.92]);       // arm not visible: hang it
    sleeve(g,c,pts,0.335,0.185);
  };
  arm([-0.430,0.055], P(13), P(15), vis(13), vis(15));
  arm([ 0.430,0.055], P(14), P(16), vis(14), vis(16));
  g.save();
  g.scale(1, Math.max(0.92,Math.min(1.22,yScale)));
  torso(g,c,1.14);
  g.restore();
  g.restore();
  return {shoulderPx, mid, ang, torsoLen};
}

/* ---- photographic try-on ----------------------------------------------
 * assets/garment.png is the hoodie keyed out of the studio shot: real fabric,
 * real folds, real drawstrings. It is near-white, so a multiply pass tints it
 * into any colourway while keeping the shading. Rigid, unlike the drawn
 * version — it scales and rotates with the shoulder line but the sleeves do
 * not follow the arms, so raising them breaks the illusion.
 */
const GARMENT = {
  src:"assets/garment.png",
  shoulderY:20, shoulderCX:156, shoulderW:222,   // the shoulder seam, not the widest row
  img:null, loaded:false, failed:false, tints:new Map()
};
export function loadGarment(){
  if(GARMENT.img) return Promise.resolve(GARMENT);
  return new Promise(res=>{
    const im=new Image();
    im.onload =()=>{ GARMENT.img=im; GARMENT.loaded=true; res(GARMENT); };
    im.onerror=()=>{ GARMENT.failed=true; res(GARMENT); };
    im.src=GARMENT.src;
  });
}
export const garmentReady = () => GARMENT.loaded;

function tinted(c){
  if(c.id==="offwhite") return GARMENT.img;          // the plate's own colour
  if(GARMENT.tints.has(c.id)) return GARMENT.tints.get(c.id);
  const w=GARMENT.img.width, h=GARMENT.img.height;
  const cv=document.createElement("canvas"); cv.width=w; cv.height=h;
  const g=cv.getContext("2d");
  g.drawImage(GARMENT.img,0,0);
  g.globalCompositeOperation="multiply";
  g.fillStyle=c.base; g.fillRect(0,0,w,h);
  g.globalCompositeOperation="destination-in";       // multiply also painted the transparent margin
  g.drawImage(GARMENT.img,0,0);
  g.globalCompositeOperation="source-over";
  GARMENT.tints.set(c.id,cv);
  return cv;
}

export function drawPhotoOnBody(g, lm, W, H, colourId, opts={}){
  if(!GARMENT.loaded) return null;
  const c=colourway(colourId);
  const P=i=>[lm[i].x*W, lm[i].y*H];
  const [ls,rs]=[P(11),P(12)];
  const shoulderPx=Math.hypot(ls[0]-rs[0], ls[1]-rs[1]);
  if(shoulderPx<20) return null;
  const mid=[(ls[0]+rs[0])/2,(ls[1]+rs[1])/2];
  const ang=Math.atan2(ls[1]-rs[1], ls[0]-rs[0]);
  const scale=(shoulderPx*(opts.ease||1.16))/GARMENT.shoulderW;
  const src=tinted(c);
  g.save();
  g.translate(mid[0],mid[1]);
  g.rotate(ang);
  g.scale(scale,scale);
  g.drawImage(src, -GARMENT.shoulderCX, -GARMENT.shoulderY);
  g.restore();
  return {shoulderPx, mid, ang};
}

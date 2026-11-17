/* =====================================================================
   CARTOGRAPHIE DCPJ – MODULE OPÉRATIONS
   • Mesures de chaque zone : superficie, périmètre, longueur × largeur
   • Relief : altitude min / max / dénivelé (modèle numérique de terrain)
   • Points de départ : commissariats, bases, postes de commandement
   • Fiche opération par zone : distances, temps estimés, contexte
   • Vue 3D du terrain (MapLibre) : zone drapée sur le relief, rotation
   Les hypothèses de calcul (vitesses, rythme de ratissage…) sont dans
   OPS_DEFAUTS ci-dessous et modifiables dans la fiche elle-même.
   ===================================================================== */
"use strict";

/* ---------- Hypothèses par défaut (à ajuster par le commandement) ---------- */
const OPS_DEFAUTS = {
  effectif: 40,          // nombre d'agents engagés
  tailleEquipe: 10,      // agents par équipe de ratissage
  vitesseVehicule: 30,   // km/h moyen sur route (état des routes en Haïti)
  detour: 1.4,           // distance route ≈ distance à vol d'oiseau × 1,4
  vitessePied: 4,        // km/h à pied en terrain plat
  rythmeRatissage: 0.25  // km² couverts par heure et par équipe, terrain plat
};
const BASE_TYPES = {comm:{label:"Commissariat",code:"CP"}, sous:{label:"Sous-commissariat",code:"SC"}, base:{label:"Base opérationnelle",code:"BO"}, pc:{label:"Poste de commandement",code:"PC"}};
const DEM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"; // relief mondial (Mapzen / AWS, libre)
if (!Array.isArray(DB.bases)) DB.bases = [];

/* =====================================================================
   1. MESURES GÉOMÉTRIQUES
   ===================================================================== */
function zonePerimKm(c){let p=0;for(let i=0;i<c.length;i++){const a=c[i],b=c[(i+1)%c.length];p+=km(a[0],a[1],b[0],b[1]);}return p;}
/* Rectangle orienté minimal → longueur et largeur réelles de la zone */
function zoneDims(c){const lat0=c.reduce((s,p)=>s+p[0],0)/c.length,kx=111.32*Math.cos(lat0*Math.PI/180),ky=110.57;
  const P=c.map(p=>[p[1]*kx,p[0]*ky]);let best=null;
  for(let d=0;d<180;d+=1){const a=d*Math.PI/180,co=Math.cos(a),si=Math.sin(a);let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
    for(const[x,y]of P){const u=x*co+y*si,v=-x*si+y*co;if(u<x0)x0=u;if(u>x1)x1=u;if(v<y0)y0=v;if(v>y1)y1=v;}
    const w=x1-x0,h=y1-y0;if(!best||w*h<best.w*best.h)best={w,h,d};}
  return {longueur:Math.max(best.w,best.h),largeur:Math.min(best.w,best.h)};}
/* Distance d'un point au bord d'un polygone (0 si le point est dedans) */
function distToPolyKm(lat,lon,c){if(inPoly(lat,lon,c))return {d:0,pt:[lat,lon]};
  const kx=111.32*Math.cos(lat*Math.PI/180),ky=110.57;let best={d:1e9,pt:null};
  for(let i=0;i<c.length;i++){const a=c[i],b=c[(i+1)%c.length];
    const ax=(a[1]-lon)*kx,ay=(a[0]-lat)*ky,bx=(b[1]-lon)*kx,by=(b[0]-lat)*ky,dx=bx-ax,dy=by-ay;
    let t=-(ax*dx+ay*dy)/((dx*dx+dy*dy)||1e-12);t=Math.max(0,Math.min(1,t));
    const px=ax+t*dx,py=ay+t*dy,d=Math.hypot(px,py);if(d<best.d)best={d,pt:[lat+py/ky,lon+px/kx]};}
  return best;}
function zoneMetrics(z){const c=z.coords;const dims=zoneDims(c);
  return {aire:polyAreaKm2(c),perim:zonePerimKm(c),longueur:dims.longueur,largeur:dims.largeur,centre:polyCentroid(c)};}

/* =====================================================================
   2. RELIEF : altitude à partir des tuiles de terrain (format Terrarium)
   ===================================================================== */
const DEM_Z=12, demCache=new Map();
function demTile(x,y){const k=x+"/"+y;if(demCache.has(k))return demCache.get(k);
  const p=new Promise((res,rej)=>{const im=new Image();im.crossOrigin="anonymous";
    im.onload=()=>{try{const cv=document.createElement("canvas");cv.width=cv.height=256;const g=cv.getContext("2d");g.drawImage(im,0,0);res(g.getImageData(0,0,256,256).data);}catch(e){rej(e);}};
    im.onerror=()=>rej(new Error("tuile relief indisponible"));im.src=DEM_URL.replace("{z}",DEM_Z).replace("{x}",x).replace("{y}",y);});
  demCache.set(k,p);p.catch(()=>demCache.delete(k));return p;}
async function elevAt(lat,lon){const n=2**DEM_Z,X=(lon+180)/360*n,r=lat*Math.PI/180,Y=(1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*n;
  const tx=Math.floor(X),ty=Math.floor(Y),px=Math.min(255,Math.floor((X-tx)*256)),py=Math.min(255,Math.floor((Y-ty)*256));
  const d=await demTile(tx,ty),i=(py*256+px)*4;return Math.round(d[i]*256+d[i+1]+d[i+2]/256-32768);}
const elevCache=new Map();
async function zoneElevation(z){const key=z.id+":"+z.coords.length+":"+z.coords[0];if(elevCache.has(key))return elevCache.get(key);
  if(HOSTED)return null;
  const c=z.coords,la=c.map(p=>p[0]),lo=c.map(p=>p[1]),a0=Math.min(...la),a1=Math.max(...la),o0=Math.min(...lo),o1=Math.max(...lo),N=16,pts=c.slice();
  for(let i=0;i<=N;i++)for(let j=0;j<=N;j++){const la_=a0+(a1-a0)*i/N,lo_=o0+(o1-o0)*j/N;if(inPoly(la_,lo_,c))pts.push([la_,lo_]);}
  try{const E=(await Promise.all(pts.map(p=>elevAt(p[0],p[1])))).map(e=>Math.max(0,e));
    const mn=Math.min(...E),mx=Math.max(...E),moy=Math.round(E.reduce((s,e)=>s+e,0)/E.length),den=mx-mn;
    const relief=den<60?{label:"Plat",f:1}:den<250?{label:"Vallonné",f:.8}:den<600?{label:"Accidenté",f:.6}:{label:"Montagneux",f:.45};
    const r={min:mn,max:mx,moy,den,relief};elevCache.set(key,r);return r;}catch(e){return null;}}

/* =====================================================================
   3. POINTS DE DÉPART (commissariats, bases, PC)
   ===================================================================== */
const basesLayer=L.layerGroup().addTo(map);
function baseSVG(code,size){size=size||28;const w=size*1.3,h=size;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="filter:drop-shadow(0 1px 3px rgba(0,0,0,.45))"><rect x="2" y="2" width="${w-4}" height="${h-4}" fill="#1e5aa8" stroke="#fff" stroke-width="2.2" rx="2"/><text x="${w/2}" y="${h/2+4}" text-anchor="middle" font-family="Consolas,monospace" font-weight="800" font-size="${h*.42}" fill="#fff">${code}</text></svg>`;}
function basePopup(b){return `<div class="pp"><h3>${esc(b.name)}</h3><div class="m">${esc(BASE_TYPES[b.type]?.label||"")} · ${esc(b.dept||"")}</div>
  <dl><dt>Position</dt><dd>MGRS ${toMGRS(b.lat,b.lon,5)}<br>${b.lat.toFixed(5)}, ${b.lon.toFixed(5)}</dd></dl>
  <div class="act"><button class="btn sm danger" onclick="delBase('${b.id}')">Retirer</button></div></div>`;}
function renderBases(){basesLayer.clearLayers();
  DB.bases.forEach(b=>L.marker([b.lat,b.lon],{icon:L.divIcon({className:"",html:baseSVG(BASE_TYPES[b.type]?.code||"BO",22),iconSize:[29,22],iconAnchor:[14,11],popupAnchor:[0,-10]}),zIndexOffset:300,title:b.name}).bindPopup(()=>basePopup(b)).addTo(basesLayer));
  const box=$("baseList");if(!box)return;
  box.innerHTML=DB.bases.length?DB.bases.map(b=>`<div class="card" style="border-left-color:#1e5aa8" onclick="focusBase('${b.id}')"><h4><span>${baseSVG(BASE_TYPES[b.type]?.code||"BO",16)}</span><span class="t">${esc(b.name)}</span></h4>
    <div class="meta">${esc(BASE_TYPES[b.type]?.label||"")} · ${esc(b.dept||"?")} · ${toMGRS(b.lat,b.lon,4)}</div></div>`).join("")
    :`<div class="empty" style="padding:12px">Aucun point de départ.<br>Ajoutez les commissariats et bases d'où partent les unités.</div>`;}
window.focusBase=id=>{const b=DB.bases.find(x=>x.id===id);if(!b)return;map.flyTo([b.lat,b.lon],14,{duration:.8});setTimeout(()=>basesLayer.eachLayer(l=>{if(l.options.title===b.name)l.openPopup();}),900);};
window.delBase=id=>{const b=DB.bases.find(x=>x.id===id);if(!b)return;askConfirm("Retirer le point de départ « "+b.name+" » ?").then(ok=>{if(!ok)return;DB.bases=DB.bases.filter(x=>x.id!==id);save();map.closePopup();renderAll();toast("Point de départ retiré");});};
const BP={lat:null,lon:null};
function setBPos(lat,lon,fromMap){BP.lat=+lat;BP.lon=+lon;$("bPos").textContent=`✔ ${toMGRS(BP.lat,BP.lon,5)} · ${deptOf(BP.lat,BP.lon)||"hors d'Haïti ?"}`;setTmp(BP.lat,BP.lon);tmp._for="base";if(!fromMap)map.setView([BP.lat,BP.lon],Math.max(map.getZoom(),13));}
window.setBPos=setBPos;
(function initBaseUI(){
  $("bType").innerHTML=Object.entries(BASE_TYPES).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join("");
  $("bNewB").onclick=()=>{$("bForm").style.display="block";$("bName").focus();};
  $("bPick").onclick=()=>startPick("base");
  $("bPlace").onchange=e=>{const r=placeLookup(e.target.value);if(r){setBPos(r.lat,r.lon,false);if(!$("bName").value)$("bName").value="Commissariat de "+r.name;}else toast("Localité introuvable : placez le point sur la carte");};
  $("bCancel").onclick=()=>{$("bForm").style.display="none";if(tmp){map.removeLayer(tmp);tmp=null;}};
  $("bSave").onclick=()=>{const name=$("bName").value.trim();if(!name)return toast("Donnez un nom");if(BP.lat==null)return toast("Placez le point sur la carte ou choisissez une localité");
    DB.bases.push({id:"B-"+Date.now().toString(36).toUpperCase(),name,type:$("bType").value,lat:BP.lat,lon:BP.lon,dept:deptOf(BP.lat,BP.lon)});save();
    ["bName","bPlace"].forEach(i=>$(i).value="");$("bPos").textContent="";BP.lat=BP.lon=null;$("bForm").style.display="none";if(tmp){map.removeLayer(tmp);tmp=null;}renderAll();toast("Point de départ ajouté");};
})();

/* =====================================================================
   4. FICHE OPÉRATION
   ===================================================================== */
const fmtH=h=>{if(!isFinite(h))return "—";const m=Math.round(h*60);return m<60?m+" min":Math.floor(m/60)+" h "+String(m%60).padStart(2,"0");};
function nearestBase(z){let best=null;DB.bases.forEach(b=>{const d=distToPolyKm(b.lat,b.lon,z.coords).d;if(!best||d<best.d)best={b,d};});return best;}
function zoneSVG(z,base){const c=z.coords,W=300,H=220,pad=16,lat0=c[0][0],kx=111.32*Math.cos(lat0*Math.PI/180),ky=110.57;
  const pts=c.map(p=>[p[1]*kx,-p[0]*ky]);let all=pts.slice();let bp=null;
  if(base){bp=[base.lon*kx,-base.lat*ky];}
  const xs=all.map(p=>p[0]),ys=all.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  const s=Math.min((W-2*pad)/((x1-x0)||1),(H-2*pad)/((y1-y0)||1)),ox=(W-(x1-x0)*s)/2,oy=(H-(y1-y0)*s)/2,T=p=>[ox+(p[0]-x0)*s,oy+(p[1]-y0)*s];
  const poly=pts.map(T).map(p=>p.map(v=>v.toFixed(1)).join(",")).join(" ");const col=ZLEV[z.level].color;
  let bar=1;for(const v of [0.1,0.2,0.5,1,2,5,10,20]){if(v*s<W*.35)bar=v;}
  let arrow="";if(bp){const cc=T([polyCentroid(c)[1]*kx,-polyCentroid(c)[0]*ky]),dx=bp[0]-(polyCentroid(c)[1]*kx),dy=bp[1]+(polyCentroid(c)[0]*ky),L_=Math.hypot(dx,dy)||1,ex=cc[0]+dx/L_*Math.min(W,H)*.42,ey=cc[1]+dy/L_*Math.min(W,H)*.42;
    arrow=`<line x1="${ex.toFixed(1)}" y1="${ey.toFixed(1)}" x2="${cc[0].toFixed(1)}" y2="${cc[1].toFixed(1)}" stroke="#1e5aa8" stroke-width="2" stroke-dasharray="5 4" marker-end="url(#ah)"/><text x="${ex.toFixed(1)}" y="${(ey-6).toFixed(1)}" font-size="9" fill="#1e5aa8" text-anchor="middle" font-weight="700">${esc(BASE_TYPES[base.type]?.code||"BO")}</text>`;}
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:360px;background:#f4f1e8;border:1px solid #ccd;border-radius:6px">
   <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="#1e5aa8"/></marker></defs>
   <polygon points="${poly}" fill="${col}40" stroke="${col}" stroke-width="2"/>${arrow}
   <g transform="translate(${W-24},26)"><path d="M0,-14L6,6L0,2L-6,6z" fill="#0e2340"/><text y="18" text-anchor="middle" font-size="9" font-weight="800" fill="#0e2340">N</text></g>
   <g transform="translate(12,${H-14})"><rect width="${(bar*s).toFixed(1)}" height="5" fill="#0e2340"/><text y="-3" font-size="9" fill="#0e2340">${bar<1?bar*1000+" m":bar+" km"}</text></g></svg>`;}
let OP={zone:null};
function opModalHTML(){return `<div class="op-modal" id="opModal"><div class="op-box">
  <div class="op-hd"><span>📋 FICHE OPÉRATION</span><button class="btn sm" id="op3d">⛰ Vue 3D</button><button class="btn sm" id="opPrintB">🖨 Imprimer</button><button class="btn sm" id="opDl">⬇ Télécharger</button><button class="btn sm danger" id="opClose">Fermer</button></div>
  <div class="op-body"><div class="op-params">
    <label>Point de départ<select id="opBase"></select></label>
    <label>Effectif (agents)<input type="number" id="opEff" min="1"></label>
    <label>Agents par équipe<input type="number" id="opEq" min="1"></label>
    <label>Vitesse véhicule (km/h)<input type="number" id="opVv" min="1"></label>
    <label>Détour route (×)<input type="number" id="opDet" step="0.1" min="1"></label>
    <label>Vitesse à pied (km/h)<input type="number" id="opVp" step="0.5" min="0.5"></label>
    <label>Ratissage (km²/h/équipe)<input type="number" id="opRat" step="0.05" min="0.01"></label>
  </div><div id="opSheet"></div></div></div></div>`;}
document.body.insertAdjacentHTML("beforeend",opModalHTML()+`<div id="opPrint" style="display:none"></div>`);
$("opClose").onclick=()=>$("opModal").classList.remove("on");
$("op3d").onclick=()=>{if(OP.zone){$("opModal").classList.remove("on");open3DZone(OP.zone.id);}};
$("opPrintB").onclick=()=>{if(HOSTED)return toast("Impression indisponible dans ce lien : téléchargez la fiche.");$("opPrint").innerHTML=$("opSheet").innerHTML;document.body.classList.add("opprint");window.print();setTimeout(()=>document.body.classList.remove("opprint"),600);};
$("opDl").onclick=()=>{if(!OP.zone)return;const html=`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Fiche opération – ${esc(OP.zone.name)}</title><style>${OP_CSS}</style></head><body>${$("opSheet").innerHTML}</body></html>`;
  download(`Fiche_operation_${OP.zone.name.replace(/^\[DÉMO\]\s*/,"").replace(/[^\wÀ-ÿ-]+/g,"_").slice(0,40)}.html`,html,"text/html;charset=utf-8");};
["opBase","opEff","opEq","opVv","opDet","opVp","opRat"].forEach(id=>$(id).addEventListener("input",()=>renderOpSheet()));
const OP_CSS=`.sheet{font:12.5px/1.45 "Segoe UI",Arial,sans-serif;color:#1b2333}.sheet h1{font-size:17px;margin:0;color:#0e2340}.sheet h2{font-size:11.5px;letter-spacing:.8px;text-transform:uppercase;color:#16365f;border-bottom:2px solid #d4a017;padding-bottom:3px;margin:16px 0 8px}
.sheet .cls{background:#0a5c2e;color:#fff;text-align:center;font:700 10.5px Consolas,monospace;letter-spacing:2px;padding:4px;margin-bottom:10px}
.sheet .hd{display:flex;gap:12px;align-items:center}.sheet .hd img{width:46px;height:46px;object-fit:contain}.sheet .sub{color:#5f6b7d;font-size:11.5px}
.sheet .grid{display:grid;grid-template-columns:1.1fr 1fr;gap:16px;align-items:start}.sheet table{width:100%;border-collapse:collapse}.sheet td{padding:4px 6px;border-bottom:1px solid #e2e7ef;vertical-align:top}.sheet td:first-child{color:#5f6b7d;width:46%}
.sheet .big{font-size:15px;font-weight:800;color:#0e2340}.sheet .warn{background:#fff3e0;border:1px solid #ffcc80;color:#8a4b00;padding:7px 9px;border-radius:5px;font-size:11.5px;margin-top:8px}
.sheet .lvl{display:inline-block;width:auto;height:auto;vertical-align:1px;padding:1px 8px;border-radius:4px;color:#fff;font-weight:700;font-size:11px}.sheet .lines div{border-bottom:1px solid #99a;height:22px}
@media (max-width:640px){.sheet .grid{grid-template-columns:1fr}}`;
document.head.insertAdjacentHTML("beforeend","<style>"+OP_CSS+"</style>");
async function renderOpSheet(){const z=OP.zone;if(!z)return;const m=zoneMetrics(z);
  const v=id=>parseFloat($(id).value);const P={eff:v("opEff")||OPS_DEFAUTS.effectif,eq:v("opEq")||OPS_DEFAUTS.tailleEquipe,vv:v("opVv")||OPS_DEFAUTS.vitesseVehicule,det:v("opDet")||OPS_DEFAUTS.detour,vp:v("opVp")||OPS_DEFAUTS.vitessePied,rat:v("opRat")||OPS_DEFAUTS.rythmeRatissage};
  const base=DB.bases.find(b=>b.id===$("opBase").value)||null;const el=OP.elev;const f=el?el.relief.f:1;
  let trajet=null;if(base){const dp=distToPolyKm(base.lat,base.lon,z.coords),dc=km(base.lat,base.lon,m.centre[0],m.centre[1]);
    trajet={vol:dp.d,volC:dc,route:dp.d*P.det,tV:dp.d*P.det/P.vv,tP:dp.d/(P.vp*f),entree:dp.pt};}
  const nEq=Math.max(1,Math.floor(P.eff/P.eq)),tRat=m.aire/(nEq*P.rat*f),tTrav=m.longueur/(P.vp*f);
  const inside=DB.alerts.filter(a=>a.stat!=="fausse"&&inPoly(a.lat,a.lon,z.coords)),near=DB.alerts.filter(a=>a.stat!=="fausse"&&!inPoly(a.lat,a.lon,z.coords)&&distToPolyKm(a.lat,a.lon,z.coords).d<=2);
  const cc={};inside.forEach(a=>cc[a.cat]=(cc[a.cat]||0)+1);
  const gangs=DB.foyers.map(g=>({g,d:distToPolyKm(g.lat,g.lon,z.coords).d})).filter(x=>x.d<=PROX_KM).sort((a,b)=>a.d-b.d);
  const src=CFG.logoData||CFG.logo,L_=ZLEV[z.level],now=new Date();
  $("opSheet").innerHTML=`<div class="sheet">
   <div class="cls">${esc(CFG.classification)}</div>
   <div class="hd">${src?`<img src="${src}" alt="">`:""}<div><h1>FICHE OPÉRATION – ${esc(z.name.replace(/^\[DÉMO\]\s*/,""))}</h1>
     <div class="sub">${esc(CFG.sigle)} – ${esc(CFG.nom)} · établie le ${now.toLocaleString("fr-FR")} · GDH ${typeof dtg==="function"?dtg(now):""}</div></div></div>
   ${z.demo?'<div class="warn">⚠ Zone FICTIVE de démonstration.</div>':""}
   <div class="grid"><div>
     <h2>1. Zone</h2><table>
      <tr><td>Niveau</td><td><span class="lvl" style="background:${L_.color};color:${z.level==="jaune"?"#3a2d00":"#fff"}">${L_.short}</span> ${esc(z.type||"")}</td></tr>
      <tr><td>Département</td><td>${esc(z.dept||"?")}</td></tr>
      <tr><td>Centre (MGRS)</td><td><b>${toMGRS(m.centre[0],m.centre[1],5)}</b></td></tr>
      <tr><td>Superficie</td><td class="big">${m.aire.toFixed(2)} km²</td></tr>
      <tr><td>Périmètre</td><td class="big">${m.perim.toFixed(2)} km</td></tr>
      <tr><td>Longueur × largeur</td><td><b>${m.longueur.toFixed(2)} km × ${m.largeur.toFixed(2)} km</b></td></tr>
     </table>
     <h2>2. Relief</h2>${el?`<table><tr><td>Altitude min / max</td><td><b>${el.min} m / ${el.max} m</b></td></tr><tr><td>Altitude moyenne</td><td>${el.moy} m</td></tr>
       <tr><td>Dénivelé</td><td class="big">${el.den} m</td></tr><tr><td>Terrain</td><td><b>${el.relief.label}</b>${f<1?` (vitesse à pied × ${f})`:""}</td></tr></table>`:`<p class="sub">${OP.elevLoading?"Calcul du relief…":"Relief indisponible (connexion internet nécessaire)."}</p>`}
   </div><div>${zoneSVG(z,base)}<div class="sub" style="margin-top:4px">Contour de la zone${base?" · flèche : direction depuis "+esc(base.name):""}</div></div></div>
   <h2>3. Mise en place depuis le point de départ</h2>${trajet?`<table>
      <tr><td>Point de départ</td><td><b>${esc(base.name)}</b> (${esc(BASE_TYPES[base.type]?.label||"")}) · ${toMGRS(base.lat,base.lon,4)}</td></tr>
      <tr><td>Distance à vol d'oiseau (jusqu'au bord / au centre)</td><td><b>${trajet.vol.toFixed(1)} km</b> / ${trajet.volC.toFixed(1)} km</td></tr>
      <tr><td>Distance route estimée (× ${P.det})</td><td><b>${trajet.route.toFixed(1)} km</b></td></tr>
      <tr><td>Temps de trajet en véhicule (${P.vv} km/h)</td><td class="big">${fmtH(trajet.tV)}</td></tr>
      <tr><td>Temps de trajet à pied</td><td>${fmtH(trajet.tP)}</td></tr>
      <tr><td>Point d'entrée le plus proche</td><td>${toMGRS(trajet.entree[0],trajet.entree[1],5)}</td></tr></table>`:`<p class="sub">Aucun point de départ enregistré : ajoutez un commissariat ou une base (onglet Zones).</p>`}
   <h2>4. Estimation de la durée d'action</h2><table>
      <tr><td>Effectif / équipes</td><td>${P.eff} agents · ${nEq} équipe(s) de ${P.eq}</td></tr>
      <tr><td>Traversée de la zone à pied (${m.longueur.toFixed(1)} km)</td><td><b>${fmtH(tTrav)}</b></td></tr>
      <tr><td>Ratissage complet (${P.rat} km²/h/équipe${f<1?" × "+f:""})</td><td class="big">${fmtH(tRat)}</td></tr>
      ${trajet?`<tr><td>Durée totale estimée (trajet véhicule + ratissage)</td><td class="big">${fmtH(trajet.tV+tRat)}</td></tr>`:""}</table>
   <div class="warn">Estimations indicatives calculées à partir des distances et des hypothèses ci-dessus. Elles ne tiennent pas compte de l'état réel des routes, des barricades, de la densité du bâti ni de la résistance rencontrée, et ne remplacent pas la reconnaissance terrain.</div>
   <h2>5. Situation dans et autour de la zone</h2><table>
      <tr><td>Alertes dans la zone</td><td><b>${inside.length}</b>${inside.length?" — "+Object.entries(cc).map(([k,n])=>`${(CATS[k]||CATS.autre).short} ${n}`).join(", "):""} · dont ${inside.filter(a=>a.grav==="critique").length} critique(s)</td></tr>
      <tr><td>Alertes à moins de 2 km</td><td>${near.length}</td></tr>
      <tr><td>Groupes armés à moins de ${PROX_KM} km</td><td>${gangs.length?gangs.map(x=>`${esc(x.g.zone.replace(/^\[DÉMO\]\s*/,""))} (${x.d.toFixed(1)} km)`).join("<br>"):"Aucun enregistré"}</td></tr></table>
   ${z.desc?`<h2>6. Description / consignes</h2><p>${esc(z.desc)}</p>`:""}
   <h2>${z.desc?7:6}. Observations du commandant</h2><div class="lines"><div></div><div></div><div></div></div>
   <p class="sub" style="margin-top:14px">Nom / grade : ______________________ &nbsp; Signature : ______________</p></div>`;}
window.openOpSheet=async id=>{const z=DB.zones.find(x=>x.id===id);if(!z)return;map.closePopup();OP={zone:z,elev:null,elevLoading:true};
  const nb=nearestBase(z);$("opBase").innerHTML=`<option value="">— aucun —</option>`+DB.bases.map(b=>`<option value="${b.id}">${esc(b.name)} (${distToPolyKm(b.lat,b.lon,z.coords).d.toFixed(1)} km)</option>`).join("");
  $("opBase").value=nb?nb.b.id:"";
  [["opEff","effectif"],["opEq","tailleEquipe"],["opVv","vitesseVehicule"],["opDet","detour"],["opVp","vitessePied"],["opRat","rythmeRatissage"]].forEach(([i,k])=>{if(!$(i).value)$(i).value=OPS_DEFAUTS[k];});
  $("opModal").classList.add("on");renderOpSheet();OP.elev=await zoneElevation(z);OP.elevLoading=false;if(OP.zone===z)renderOpSheet();};

/* =====================================================================
   5. VUE 3D (MapLibre GL, chargée à la demande)
   ===================================================================== */
let ML=null,V3={map:null,spin:0,markers:[]};
function loadML(){if(window.maplibregl)return Promise.resolve();if(ML)return ML;
  ML=new Promise((res,rej)=>{const l=document.createElement("link");l.rel="stylesheet";l.href="lib/maplibre/maplibre-gl.css";document.head.appendChild(l);
    const s=document.createElement("script");s.src="lib/maplibre/maplibre-gl.js";s.onload=()=>res();s.onerror=()=>{ML=null;rej(new Error("MapLibre introuvable"));};document.head.appendChild(s);});return ML;}
document.body.insertAdjacentHTML("beforeend",`<div class="v3d" id="v3d"><div id="v3dMap"></div>
  <div class="v3d-panel"><div class="v3d-t" id="v3dT">VUE 3D</div><div id="v3dInfo"></div>
   <label class="v3d-l">Exagération du relief <b id="v3dExV">1.5×</b><input type="range" id="v3dEx" min="1" max="3" step="0.1" value="1.5"></label>
   <div class="v3d-b"><button class="c-btn" id="v3dSpin">⟳ TOUR 360°</button><button class="c-btn" id="v3dTop">▣ DESSUS</button><button class="c-btn" id="v3dTilt">◢ INCLINER</button><button class="c-btn" id="v3dBase">◎ TOPO</button>
   <button class="c-btn" id="v3dOp">📋 FICHE</button><button class="c-btn x" id="v3dClose">✕ FERMER</button></div>
   <div class="v3d-h">Clic droit + glisser (ou deux doigts) pour faire pivoter et incliner.</div><div class="v3d-alt" id="v3dAlt"></div></div></div>`);
function gj(features){return {type:"FeatureCollection",features};}
async function open3D(opt){
  if(HOSTED)return toast("La vue 3D n'est pas disponible dans le lien claude.ai : utilisez le site ou la version installée.");
  try{await loadML();}catch(e){return toast("Impossible de charger la vue 3D ("+e.message+").");}
  $("v3d").classList.add("on");$("v3dT").textContent=opt.title;$("v3dInfo").innerHTML=opt.info||"";
  const ESRI_="https://server.arcgisonline.com/ArcGIS/rest/services/";
  if(!V3.map){V3.map=new maplibregl.Map({container:"v3dMap",maxPitch:80,attributionControl:{compact:true},
    style:{version:8,sources:{
      sat:{type:"raster",tiles:[ESRI_+"World_Imagery/MapServer/tile/{z}/{y}/{x}"],tileSize:256,maxzoom:19,attribution:"Imagerie © Esri, Maxar"},
      topo:{type:"raster",tiles:[ESRI_+"World_Topo_Map/MapServer/tile/{z}/{y}/{x}"],tileSize:256,maxzoom:19,attribution:"© Esri"},
      dem:{type:"raster-dem",tiles:[DEM_URL],tileSize:256,encoding:"terrarium",maxzoom:14,attribution:"Relief © Mapzen, AWS"},
      hsdem:{type:"raster-dem",tiles:[DEM_URL],tileSize:256,encoding:"terrarium",maxzoom:14}},
     layers:[{id:"sat",type:"raster",source:"sat"},{id:"topo",type:"raster",source:"topo",layout:{visibility:"none"}},
       {id:"hs",type:"hillshade",source:"hsdem",paint:{"hillshade-exaggeration":.3,"hillshade-shadow-color":"#1b2333"}}],
     terrain:{source:"dem",exaggeration:1.5},sky:{"sky-color":"#0b1e33","horizon-color":"#2c5476","fog-color":"#0b1e33","sky-horizon-blend":.6,"horizon-fog-blend":.6,"fog-ground-blend":.4}},
    center:[opt.center[1],opt.center[0]],zoom:12,pitch:62,bearing:-20});
    V3.map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),"top-right");
    V3.map.addControl(new maplibregl.ScaleControl({unit:"metric"}),"bottom-left");
    await new Promise(r=>V3.map.on("load",r));
    V3.map.addSource("zones",{type:"geojson",data:gj([])});V3.map.addSource("route",{type:"geojson",data:gj([])});
    V3.map.addLayer({id:"z-fill",type:"fill",source:"zones",paint:{"fill-color":["get","col"],"fill-opacity":["case",["get","sel"],.32,.16]}});
    V3.map.addLayer({id:"z-line",type:"line",source:"zones",paint:{"line-color":["get","col"],"line-width":["case",["get","sel"],4,2],"line-opacity":.95}});
    V3.map.addLayer({id:"route",type:"line",source:"route",paint:{"line-color":"#5fb0ff","line-width":3,"line-dasharray":[2,2]}});
    let lastQ=0;V3.map.on("mousemove",e=>{const t=performance.now();if(t-lastQ<120)return;lastQ=t;
      elevAt(e.lngLat.lat,e.lngLat.lng).then(h=>{$("v3dAlt").innerHTML=`<b>ALT</b> ${Math.max(0,h)} m · <b>MGRS</b> ${toMGRS(e.lngLat.lat,e.lngLat.lng,5)}`;}).catch(()=>{});});
    $("v3dEx").oninput=e=>{const v=+e.target.value;$("v3dExV").textContent=v.toFixed(1)+"×";V3.map.setTerrain({source:"dem",exaggeration:v});};
    $("v3dSpin").onclick=()=>{if(V3.spin){cancelAnimationFrame(V3.spin);V3.spin=0;$("v3dSpin").classList.remove("on");return;}$("v3dSpin").classList.add("on");
      const step=()=>{V3.map.setBearing((V3.map.getBearing()+0.18)%360);V3.spin=requestAnimationFrame(step);};V3.spin=requestAnimationFrame(step);};
    $("v3dTop").onclick=()=>V3.map.easeTo({pitch:0,bearing:0,duration:1200});
    $("v3dTilt").onclick=()=>V3.map.easeTo({pitch:65,bearing:V3.map.getBearing()-30,duration:1400});
    $("v3dBase").onclick=()=>{const topo=V3.map.getLayoutProperty("topo","visibility")==="visible";V3.map.setLayoutProperty("topo","visibility",topo?"none":"visible");V3.map.setLayoutProperty("sat","visibility",topo?"visible":"none");$("v3dBase").textContent=topo?"◎ TOPO":"◎ SATELLITE";};
    $("v3dClose").onclick=close3D;
  }
  // données
  V3.map.getSource("zones").setData(gj(DB.zones.map(z=>({type:"Feature",properties:{col:ZLEV[z.level].color,sel:z.id===opt.zoneId},geometry:{type:"Polygon",coordinates:[z.coords.concat([z.coords[0]]).map(c=>[c[1],c[0]])]}}))));
  V3.map.getSource("route").setData(gj(opt.route?[{type:"Feature",properties:{},geometry:{type:"LineString",coordinates:opt.route.map(p=>[p[1],p[0]])}}]:[]));
  V3.markers.forEach(m=>m.remove());V3.markers=[];
  const mk=(lat,lon,html,title)=>{const d=document.createElement("div");d.className="v3m";d.innerHTML=html;d.title=title||"";V3.markers.push(new maplibregl.Marker({element:d,anchor:"center"}).setLngLat([lon,lat]).addTo(V3.map));};
  DB.foyers.forEach(f=>mk(f.lat,f.lon,(typeof symSVG==="function"?symSVG("hostile","#ff4545","GA",28):"GA")+`<span>${esc((f.zone||"").replace(/^\[DÉMO\]\s*/,"").split("–")[0].split("/")[0].trim())}</span>`,f.zone));
  DB.bases.forEach(b=>mk(b.lat,b.lon,baseSVG(BASE_TYPES[b.type]?.code||"BO",22)+`<span class="bl">${esc(b.name)}</span>`,b.name));
  DB.alerts.filter(a=>a.stat!=="fausse").forEach(a=>{const [k,c]=typeof symFor==="function"?symFor(a):["unknown","#ffd23f"];mk(a.lat,a.lon,typeof symSVG==="function"?symSVG(k,c,(typeof CODE!=="undefined"?CODE[a.cat]:"")||"??",20):"•",a.title);});
  if(opt.bounds){V3.map.resize();V3.map.fitBounds([[opt.bounds[0][1],opt.bounds[0][0]],[opt.bounds[1][1],opt.bounds[1][0]]],{padding:{top:60,bottom:60,left:60,right:360},pitch:62,bearing:-25,duration:0,maxZoom:15});}
  else{V3.map.resize();V3.map.jumpTo({center:[opt.center[1],opt.center[0]],zoom:opt.zoom||13.5,pitch:62,bearing:-25});}
}
function close3D(){$("v3d").classList.remove("on");if(V3.spin){cancelAnimationFrame(V3.spin);V3.spin=0;$("v3dSpin").classList.remove("on");}}
window.open3DZone=async id=>{const z=DB.zones.find(x=>x.id===id);if(!z)return;map.closePopup();const m=zoneMetrics(z),nb=nearestBase(z);
  const lat=z.coords.map(c=>c[0]),lon=z.coords.map(c=>c[1]);let b=[[Math.min(...lat),Math.min(...lon)],[Math.max(...lat),Math.max(...lon)]];
  let route=null;if(nb){const dp=distToPolyKm(nb.b.lat,nb.b.lon,z.coords);route=[[nb.b.lat,nb.b.lon],dp.pt];
    if(nb.d<15)b=[[Math.min(b[0][0],nb.b.lat),Math.min(b[0][1],nb.b.lon)],[Math.max(b[1][0],nb.b.lat),Math.max(b[1][1],nb.b.lon)]];}
  const info=()=>`<div class="v3d-k"><span>SUPERFICIE</span><b>${m.aire.toFixed(2)} km²</b></div><div class="v3d-k"><span>PÉRIMÈTRE</span><b>${m.perim.toFixed(2)} km</b></div>
    <div class="v3d-k"><span>LONGUEUR × LARGEUR</span><b>${m.longueur.toFixed(1)} × ${m.largeur.toFixed(1)} km</b></div>
    <div class="v3d-k"><span>ALTITUDE MIN / MAX</span><b id="v3dEl">calcul…</b></div><div class="v3d-k"><span>DÉNIVELÉ / TERRAIN</span><b id="v3dDen">…</b></div>
    ${nb?`<div class="v3d-k"><span>DEPUIS ${esc(nb.b.name.toUpperCase())}</span><b>${nb.d.toFixed(1)} km vol d'oiseau</b></div>`:""}
    <div class="v3d-k"><span>CENTRE (MGRS)</span><b>${toMGRS(m.centre[0],m.centre[1],5)}</b></div>`;
  $("v3dOp").style.display="";$("v3dOp").onclick=()=>{close3D();openOpSheet(z.id);};
  await open3D({title:"⛰ "+z.name.replace(/^\[DÉMO\]\s*/,"").toUpperCase(),info:info(),bounds:b,zoneId:z.id,route,center:m.centre});
  const el=await zoneElevation(z);if($("v3dEl")){$("v3dEl").textContent=el?`${el.min} m / ${el.max} m`:"indisponible";$("v3dDen").textContent=el?`${el.den} m · ${el.relief.label}`:"—";}};
window.open3DPoint=(lat,lon,title)=>{map.closePopup();$("v3dOp").style.display="none";
  open3D({title:"⛰ "+String(title||"").replace(/^\[DÉMO\]\s*/,"").toUpperCase(),info:`<div class="v3d-k"><span>POSITION (MGRS)</span><b>${toMGRS(lat,lon,5)}</b></div><div class="v3d-k"><span>ALTITUDE</span><b id="v3dPt">…</b></div>`,center:[lat,lon],zoom:14});
  elevAt(lat,lon).then(h=>{if($("v3dPt"))$("v3dPt").textContent=Math.max(0,h)+" m";}).catch(()=>{});};
document.addEventListener("keydown",e=>{if(e.key==="Escape"){if($("v3d").classList.contains("on"))close3D();else if($("opModal").classList.contains("on"))$("opModal").classList.remove("on");}});

/* =====================================================================
   6. Mode Commandement : forces amies (bleu) sur la carte et le radar
   ===================================================================== */
function cmdBases(){if(typeof CM==="undefined"||!CM||!CM.map)return;if(!CM.bases)CM.bases=L.layerGroup().addTo(CM.map);CM.bases.clearLayers();
  DB.bases.forEach(b=>L.marker([b.lat,b.lon],{icon:L.divIcon({className:"",html:baseSVG(BASE_TYPES[b.type]?.code||"BO",22),iconSize:[29,22],iconAnchor:[14,11]})}).bindPopup(()=>basePopup(b)).addTo(CM.bases));}
renderBases();

/* Ouverture 3D depuis un foyer de gang */
window.open3DFoyer=id=>{const f=DB.foyers.find(x=>x.id===id);if(f)open3DPoint(f.lat,f.lon,f.zone);};
/* Points de départ FICTIFS pour la démonstration */
function addDemoBases(){if(DB.bases.some(b=>b.demo))return;
  [["Croix-des-Bouquets","comm",.03,-.03],["Port-au-Prince","base",-.02,.02],["Saint-Marc","comm",.02,.02],["Cap-Haïtien","comm",-.015,-.02],["Milot","sous",.02,.0],["Mirebalais","comm",.02,-.02]]
  .forEach(([pl,ty,dl,dn],i)=>{const r=placeLookup(pl);if(!r)return;const lat=r.lat+dl,lon=r.lon+dn;
    DB.bases.push({id:"B-DEMO-"+i,name:"[DÉMO] "+BASE_TYPES[ty].label+" fictif – "+r.name,type:ty,lat,lon,dept:deptOf(lat,lon),demo:true});});}
if(typeof LAYERS!=="undefined")LAYERS.addOverlay(basesLayer,"Points de départ (forces amies)");

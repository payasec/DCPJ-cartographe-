/* =====================================================================
   CARTOGRAPHIE DCPJ – MOTEUR PRINCIPAL
   Carte, alertes, foyers de gangs, zones d'insécurité, analyse, import/export.
   Les réglages courants sont dans js/config.js : modifiez-les là d'abord.
   ===================================================================== */
"use strict";
/* Le logiciel peut tourner de deux façons :
   - installé (index.html ouvert depuis le dossier) : tout fonctionne ;
   - publié en lien claude.ai (HOSTED) : les fonds de carte externes, l'impression et
     les fenêtres de confirmation du navigateur y sont bloqués ; on s'adapte. */
const HOSTED = !!(window.claude && typeof window.claude.use === "function");
let DLCAP = null;
if (HOSTED) { try { window.claude.use("downloads").then(d => { DLCAP = d; }).catch(() => {}); } catch (e) {} }
DEPTS_GEO.features.forEach(f=>{ if(f.properties.name==="L'Artibonite") f.properties.name="Artibonite"; });
const DEPT_NAMES = DEPTS_GEO.features.map(f=>f.properties.name).sort((a,b)=>a.localeCompare(b,"fr"));
let PROX_KM = UNITE.proximiteKm || 5;
const SEED_FOYERS = FOYERS_INITIAUX.map((f,i)=>Object.assign({id:"F-NORD-"+String(i+1).padStart(2,"0"),rad:1.2,src:"Rapport SDPJ/Nord du 26/10/2026",approx:true},f));

/* ===================== Stockage ===================== */
const KEY="vigie_geo_v1";
let DB={alerts:[],foyers:SEED_FOYERS.slice(),seq:1};
let storageOK=true;
let FIRST_RUN=true;
try{ const raw=localStorage.getItem(KEY); if(raw){ FIRST_RUN=false; const d=JSON.parse(raw); if(d&&d.alerts) DB=d; } }catch(e){ storageOK=false; }
if(!Array.isArray(DB.zones)) DB.zones=[];
/* Paramètres de l'unité : valeurs du fichier de configuration, remplacées par celles saisies dans l'onglet ⚙ */
const CFG_KEY="vigie_cfg_v1";
let CFG=Object.assign({},UNITE);
try{Object.assign(CFG,JSON.parse(localStorage.getItem(CFG_KEY)||"{}"));}catch(e){}
PROX_KM=+CFG.proximiteKm||5;
function save(){ try{ localStorage.setItem(KEY,JSON.stringify(DB)); }catch(e){ if(storageOK){ storageOK=false; toast("⚠ Sauvegarde automatique impossible dans ce navigateur : utilisez « Sauvegarde complète »."); } } }

/* ===================== Utilitaires ===================== */
function askConfirm(msg){return new Promise(res=>{const m=document.getElementById("cfModal");document.getElementById("cfMsg").textContent=msg;m.classList.add("on");
  const done=v=>{m.classList.remove("on");document.getElementById("cfOk").onclick=document.getElementById("cfNo").onclick=null;res(v);};
  document.getElementById("cfOk").onclick=()=>done(true);document.getElementById("cfNo").onclick=()=>done(false);});}
function doPrint(){if(HOSTED){toast("Impression indisponible dans ce lien : exportez le fichier, ou utilisez la version installée.");return;}window.print();}
window.doPrint=doPrint;
const $=id=>document.getElementById(id);
const norm=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();
const alnum=s=>norm(s).replace(/[^a-z0-9]/g,"");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(m){const t=$("toast");t.textContent=m;t.classList.add("on");clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove("on"),3200);}
function km(a,b,c,d){const R=6371,r=Math.PI/180,x=(c-a)*r,y=(d-b)*r;const h=Math.sin(x/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(y/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
function inRing(lon,lat,ring){let ins=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];if(((yi>lat)!==(yj>lat))&&(lon<(xj-xi)*(lat-yi)/(yj-yi)+xi))ins=!ins;}return ins;}
function deptOf(lat,lon){
  for(const f of DEPTS_GEO.features){const g=f.geometry;const polys=g.type==="Polygon"?[g.coordinates]:g.coordinates;
    for(const p of polys){ if(inRing(lon,lat,p[0]) && !p.slice(1).some(h=>inRing(lon,lat,h))) return f.properties.name; } }
  // hors polygone (côte) : place la plus proche
  const n=nearestPlace(lat,lon); return n&&n.d<15?n.p[1]:"";
}
function inPoly(lat,lon,coords){return inRing(lon,lat,coords.map(c=>[c[1],c[0]]));}
function zonesAt(lat,lon){return DB.zones.filter(z=>inPoly(lat,lon,z.coords));}
const LORD={rouge:0,orange:1,jaune:2};
function worstZone(lat,lon){return zonesAt(lat,lon).sort((a,b)=>LORD[a.level]-LORD[b.level])[0]||null;}
function polyCentroid(c){let a=0,x=0,y=0;for(let i=0,j=c.length-1;i<c.length;j=i++){const f=c[j][1]*c[i][0]-c[i][1]*c[j][0];a+=f;x+=(c[j][1]+c[i][1])*f;y+=(c[j][0]+c[i][0])*f;}
  if(Math.abs(a)<1e-12){return [c.reduce((s,p)=>s+p[0],0)/c.length,c.reduce((s,p)=>s+p[1],0)/c.length];}a*=3;return [y/a,x/a];}
function polyAreaKm2(c){const R=6371,r=Math.PI/180,lat0=c.reduce((s,p)=>s+p[0],0)/c.length*r;let a=0;
  for(let i=0,j=c.length-1;i<c.length;j=i++){const xi=c[i][1]*r*R*Math.cos(lat0),yi=c[i][0]*r*R,xj=c[j][1]*r*R*Math.cos(lat0),yj=c[j][0]*r*R;a+=xj*yi-xi*yj;}return Math.abs(a/2);}
function nearestPlace(lat,lon){let best=null;for(const p of PLACES){const d=km(lat,lon,p[2],p[3]);if(!best||d<best.d)best={p,d};}return best;}
function nearestFoyer(lat,lon){let best=null;for(const f of DB.foyers){const d=km(lat,lon,f.lat,f.lon);if(!best||d<best.d)best={f,d};}return best;}
function fmtDate(iso){const d=new Date(iso);if(isNaN(d))return "—";return d.toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"})+" "+d.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});}
function ago(iso){const s=(Date.now()-new Date(iso))/1000;if(isNaN(s))return "";if(s<60)return "à l'instant";if(s<3600)return "il y a "+Math.floor(s/60)+" min";if(s<86400)return "il y a "+Math.floor(s/3600)+" h";return "il y a "+Math.floor(s/86400)+" j";}
function localISO(d){const z=new Date(d.getTime()-d.getTimezoneOffset()*60000);return z.toISOString().slice(0,16);}
function nextId(){const y=new Date().getFullYear();const id="VG-"+y+"-"+String(DB.seq++).padStart(4,"0");return id;}
function fillSel(el,obj,first){el.innerHTML=(first?`<option value="">${first}</option>`:"")+Object.entries(obj).map(([k,v])=>`<option value="${k}">${v.label||v}</option>`).join("");}

/* ===================== Carte ===================== */
const HT_BOUNDS=L.latLngBounds([17.95,-74.55],[20.15,-71.55]);
const map=L.map("map",{zoomControl:true,minZoom:7,maxZoom:18,maxBounds:HT_BOUNDS.pad(0.6),worldCopyJump:false});
const ESRI="https://server.arcgisonline.com/ArcGIS/rest/services/";
const NOBASE = HOSTED;   // dans le lien claude.ai, les images externes (fonds de carte) sont bloquées : fond « hors ligne »
const bases = NOBASE ? {"Fond hors ligne": L.layerGroup()} : {
  "Plan": L.tileLayer(ESRI+"World_Street_Map/MapServer/tile/{z}/{y}/{x}",{maxZoom:19,attribution:"Fond © Esri, HERE, Garmin, OpenStreetMap"}),
  "Gris clair": L.tileLayer(ESRI+"Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",{maxZoom:16,attribution:"Fond © Esri"}),
  "Satellite": L.tileLayer(ESRI+"World_Imagery/MapServer/tile/{z}/{y}/{x}",{maxZoom:19,attribution:"Imagerie © Esri, Maxar, Earthstar"}),
  "Relief": L.tileLayer(ESRI+"World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}",{maxZoom:18,maxNativeZoom:13,attribution:"Relief © Esri"}),
  "Topographique": L.tileLayer(ESRI+"World_Topo_Map/MapServer/tile/{z}/{y}/{x}",{maxZoom:19,attribution:"Topo © Esri, HERE, Garmin, OpenStreetMap"})
};
bases[Object.keys(bases)[0]].addTo(map);
if (NOBASE) document.getElementById("map").classList.add("nobase");
map.fitBounds(HT_BOUNDS);

// Départements
const depLayer=L.geoJSON(DEPTS_GEO,{style:NOBASE?{color:"#0e2340",weight:1.2,opacity:.75,fillColor:"#f4efe3",fillOpacity:1,dashArray:"4 3"}:{color:"#0e2340",weight:1.4,opacity:.7,fillColor:"#0e2340",fillOpacity:.03,dashArray:"4 3"},
  onEachFeature:(f,l)=>{
    l.on("mouseover",()=>{l.setStyle(NOBASE?{fillColor:"#e9dfc6",weight:2.2}:{fillOpacity:.10,weight:2.2});});
    l.on("mouseout",()=>{depLayer.resetStyle(l);});
    l.on("click",e=>{ if(pick) return; const n=f.properties.name;
      const a=DB.alerts.filter(x=>x.dept===n).length, fo=DB.foyers.filter(x=>(x.dept||deptOf(x.lat,x.lon))===n).length;
      const ix=IDX[n]||{idx:0},zc=DB.zones.filter(z=>z.dept===n).length;
      L.popup().setLatLng(e.latlng).setContent(`<div class="pp"><h3>${esc(n)}</h3><p>${a} alerte(s) · ${fo} foyer(s) de gang · ${zc} zone(s) délimitée(s)<br>Indice d'insécurité : <b>${ix.idx}</b> – ${idxCls(ix.idx).label}</p><button class="btn sm" onclick="filterDept('${esc(n).replace(/'/g,"\\'")}')">Voir les alertes du département</button></div>`).openOn(map);});
  }}).addTo(map);
const depLabels=L.layerGroup().addTo(map);
DEPTS_GEO.features.forEach(f=>{const b=L.geoJSON(f).getBounds();const c=b.getCenter();
  const fix={"Ouest":[18.62,-72.55],"Nord-Ouest":[19.78,-73.05],"Sud":[18.27,-73.75],"Nord":[19.52,-72.35],"Sud-Est":[18.30,-72.35],"Nippes":[18.40,-73.30]};
  const p=fix[f.properties.name]||[c.lat,c.lng];
  L.tooltip({permanent:true,direction:"center",className:"dlabel"}).setLatLng(p).setContent(f.properties.name).addTo(depLabels);});
function updLabels(){ const z=map.getZoom(); if(z>=10){map.removeLayer(depLabels);} else if(!map.hasLayer(depLabels)&&map.hasLayer(depLayer)){depLabels.addTo(map);} }
map.on("zoomend",updLabels);

// Foyers
const foyerLayer=L.layerGroup().addTo(map);
// Alertes
const alertLayer=L.markerClusterGroup({showCoverageOnHover:false,maxClusterRadius:42,spiderfyOnMaxZoom:true,
  iconCreateFunction:c=>{const n=c.getChildCount();const s=n<10?34:n<50?40:48;return L.divIcon({html:`<div class="cl" style="width:${s}px;height:${s}px">${n}</div>`,className:"",iconSize:[s,s]});}}).addTo(map);
// Chaleur
const heat=L.heatLayer([],{radius:30,blur:22,maxZoom:8,minOpacity:.4,gradient:{.2:"#2c7bb6",.45:"#ffffbf",.7:"#fdae61",1:"#d7191c"}});

// Zones d'insécurité, foyers de violence, indice départemental
map.createPane("zonesPane");map.getPane("zonesPane").style.zIndex=380;
map.createPane("idxPane");map.getPane("idxPane").style.zIndex=350;
const zoneLayer=L.layerGroup().addTo(map);
const zoneLabels=L.layerGroup();
function updZoneLabels(){if(map.getZoom()>=10&&map.hasLayer(zoneLayer)){if(!map.hasLayer(zoneLabels))zoneLabels.addTo(map);}else map.removeLayer(zoneLabels);}
map.on("zoomend",updZoneLabels);
const hotLayer=L.layerGroup().addTo(map);
let IDX={};
const idxLayer=L.geoJSON(DEPTS_GEO,{pane:"idxPane",style:f=>{const v=(IDX[f.properties.name]||{}).idx||0;return {color:"#fff",weight:1.2,fillColor:idxCls(v).color,fillOpacity:.62};},
  onEachFeature:(f,l)=>l.bindTooltip(()=>{const d=IDX[f.properties.name]||{idx:0};return `<b>${esc(f.properties.name)}</b><br>Indice : ${d.idx} – ${idxCls(d.idx).label}`;},{sticky:true})});
const LAYERS=L.control.layers(bases,{"Alertes":alertLayer,"Carte de chaleur des alertes":heat,"Foyers de gangs armés":foyerLayer,"Zones d'insécurité":zoneLayer,"Foyers de violence (détection auto)":hotLayer,"Indice d'insécurité par département":idxLayer,"Limites des départements":depLayer},{collapsed:true}).addTo(map);
map.on("overlayadd overlayremove",e=>{ if(e.layer===depLayer){ if(e.type==="overlayadd") updLabels(); else map.removeLayer(depLabels);} if(e.layer===idxLayer) renderLegend(); if(e.layer===zoneLayer) updZoneLabels(); });
L.control.scale({imperial:false}).addTo(map);
const legend=L.control({position:"bottomright"});
legend.onAdd=()=>{const d=L.DomUtil.create("div","legend");d.id="legendBox";L.DomEvent.disableClickPropagation(d);return d;};
legend.addTo(map);
function renderLegend(){const d=$("legendBox");if(!d)return;
  let h="<b>Alertes</b>"+Object.values(CATS).map(c=>`<i style="background:${c.color}"></i>${c.short}`).join(" &nbsp;").replace(/ &nbsp;<i style="background:#e65100/,"<br><i style=\"background:#e65100");
  h+=`<b style="margin-top:6px">Gangs et violence</b><i class="sq"></i>Foyer de gang signalé<br><i style="background:#7a1fa2"></i>Foyer de violence détecté`;
  h+=`<b style="margin-top:6px">Zones d'insécurité</b>`+Object.values(ZLEV).map(z=>`<span class="lvl" style="background:${z.color};opacity:.8"></span>${z.short}`).join(" &nbsp; ");
  if(map.hasLayer(idxLayer)) h+=`<b style="margin-top:6px">Indice départemental</b>`+IDX_CLS.slice().reverse().map(c=>`<span class="lvl" style="background:${c.color}"></span>${c.label}`).join("<br>");
  d.innerHTML=h;}

/* ===================== Rendu ===================== */
const markers={};
const F={cats:new Set(),q:"",grav:"",stat:"",per:"",dep:""};

function alertIcon(a){const c=CATS[a.cat]||CATS.autre;const crit=(a.grav==="critique"&&!["traitee","fausse"].includes(a.stat));
  const dim=["traitee","fausse"].includes(a.stat)?"opacity:.55;":"";
  return L.divIcon({className:"",html:`<div class="am${crit?" crit":""}" style="background:${c.color};${dim}">${c.ch}</div>`,iconSize:[26,26],iconAnchor:[13,13],popupAnchor:[0,-12]});}

function proxInfo(a){const n=nearestFoyer(a.lat,a.lon);return n?{f:n.f,d:n.d}:null;}

function alertPopup(a){const c=CATS[a.cat]||CATS.autre,g=GRAV[a.grav]||GRAV.moyenne,s=STAT[a.stat]||STAT.nouvelle;const p=proxInfo(a);
  return `<div class="pp"><h3>${esc(a.title)}</h3><div class="m">${esc(a.id)} · ${fmtDate(a.date)}</div>
  <div class="badges"><span class="bdg" style="background:${c.color}">${c.short}</span><span class="bdg" style="background:${g.color}">${g.label}</span><span class="bdg" style="background:${s.color}">${s.label}</span>${a.demo?'<span class="bdg out">DÉMO</span>':""}</div>
  ${a.desc?`<p>${esc(a.desc)}</p>`:""}
  <dl><dt>Lieu</dt><dd>${esc(a.place||"—")} · ${esc(a.dept||"?")} <span class="m">(${a.lat.toFixed(5)}, ${a.lon.toFixed(5)}${a.prec==="approx"?", approximatif":""})</span></dd>
  <dt>Source</dt><dd>${esc(a.src||"—")}${a.link?`<br><span class="m">${/^https?:\/\//i.test(a.link)?`<a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">${esc(a.link)}</a>`:esc(a.link)}</span>`:""}</dd>
  ${(()=>{const z=worstZone(a.lat,a.lon);return z?`<dt>Zone d'insécurité</dt><dd><span class="lvl" style="background:${ZLEV[z.level].color}"></span>${esc(z.name)} (${ZLEV[z.level].short})</dd>`:"";})()}
  ${p?`<dt>Foyer de gang le plus proche</dt><dd>${p.d<PROX_KM?"⚠ ":""}${esc(p.f.zone)} — <b>${p.d.toFixed(1)} km</b></dd>`:""}</dl>
  <div class="act"><select onchange="setStat('${a.id}',this.value)">${Object.entries(STAT).map(([k,v])=>`<option value="${k}" ${k===a.stat?"selected":""}>${v.label}</option>`).join("")}</select>
  <button class="btn sm danger" onclick="delAlert('${a.id}')">Supprimer</button></div></div>`;}

function foyerPopup(f){return `<div class="pp"><h3>${esc(f.zone)}</h3><div class="m">${esc(f.dept||deptOf(f.lat,f.lon))} · ${esc(f.src||"")}${f.approx?" · position indicative":""}</div>
  <div class="badges">${(f.cats||[]).map(k=>`<span class="bdg" style="background:#7f0000">${esc(FCATS[k]||k)}</span>`).join("")}</div>
  <dl><dt>Chef(s) de file</dt><dd>${esc(f.chef||"—")}</dd><dt>Membres connus</dt><dd>${esc(f.membres||"—")}</dd><dt>Activités</dt><dd>${esc(f.act||"—")}</dd>
  <dt>Alertes à moins de ${PROX_KM} km</dt><dd>${DB.alerts.filter(a=>km(a.lat,a.lon,f.lat,f.lon)<PROX_KM).length}</dd></dl>
  <div class="act"><button class="btn sm pri" onclick="open3DFoyer('${f.id}')">⛰ Vue 3D</button><button class="btn sm danger" onclick="delFoyer('${f.id}')">Retirer ce foyer</button></div></div>`;}

function passes(a){
  if(F.cats.size&&!F.cats.has(a.cat))return false;
  if(F.grav&&a.grav!==F.grav)return false;
  if(F.stat&&a.stat!==F.stat)return false;
  if(F.dep&&a.dept!==F.dep)return false;
  if(F.per&&(Date.now()-new Date(a.date))>F.per*86400000)return false;
  if(F.q){const s=(a.title+" "+a.place+" "+a.desc+" "+a.id+" "+a.dept).toLowerCase();if(!s.includes(F.q))return false;}
  return true;}

function renderMap(){
  alertLayer.clearLayers();for(const k in markers)delete markers[k];
  const pts=[];
  DB.alerts.filter(passes).forEach(a=>{
    const m=L.marker([a.lat,a.lon],{icon:alertIcon(a),title:a.title}).bindPopup(()=>alertPopup(a),{maxWidth:340});
    m.on("click",()=>highlight(a.id));markers[a.id]=m;alertLayer.addLayer(m);
    if(!["fausse"].includes(a.stat))pts.push([a.lat,a.lon,(GRAV[a.grav]||GRAV.moyenne).w]);});
  heat.setLatLngs(pts);
  foyerLayer.clearLayers();
  DB.foyers.forEach(f=>{
    L.circle([f.lat,f.lon],{radius:(f.rad||1.2)*1000,color:"#7f0000",weight:1.3,opacity:.6,fillColor:"#b71c1c",fillOpacity:.13,dashArray:f.approx?"5 4":null,interactive:false}).addTo(foyerLayer);
    L.marker([f.lat,f.lon],{icon:L.divIcon({className:"",html:`<div class="fm"><span>${esc((f.zone||"?").trim()[0]||"G")}</span></div>`,iconSize:[30,30],iconAnchor:[15,15],popupAnchor:[0,-14]}),title:f.zone,zIndexOffset:-100})
     .bindPopup(()=>foyerPopup(f),{maxWidth:340}).addTo(foyerLayer);});
}

function renderList(){
  const list=DB.alerts.filter(passes).sort((a,b)=>new Date(b.date)-new Date(a.date));
  $("nRes").textContent=`${list.length} alerte(s) affichée(s) sur ${DB.alerts.length}`;
  $("alertList").innerHTML=list.length?list.map(a=>{const c=CATS[a.cat]||CATS.autre,g=GRAV[a.grav]||GRAV.moyenne,s=STAT[a.stat]||STAT.nouvelle;const p=proxInfo(a);
    return `<div class="card" id="c-${a.id}" style="border-left-color:${c.color}" onclick="focusAlert('${a.id}')">
      <h4><span class="t">${esc(a.title)}</span></h4>
      <div class="meta">${esc(a.place||"—")} · ${esc(a.dept||"?")} · ${ago(a.date)}</div>
      <div class="badges"><span class="bdg" style="background:${c.color}">${c.short}</span><span class="bdg" style="background:${g.color}">${g.label}</span><span class="bdg" style="background:${s.color}">${s.label}</span>
      ${p&&p.d<PROX_KM?`<span class="bdg prox">⚠ ${p.d.toFixed(1)} km d'un foyer</span>`:""}${(()=>{const z=worstZone(a.lat,a.lon);return z?`<span class="bdg" style="background:${ZLEV[z.level].color};color:${z.level==="jaune"?"#3a2d00":"#fff"}">Zone ${ZLEV[z.level].short.toLowerCase()}</span>`:"";})()}${a.demo?'<span class="bdg out">DÉMO</span>':""}</div></div>`;}).join("")
    :`<div class="empty">Aucune alerte${DB.alerts.length?" ne correspond aux filtres":" pour l'instant"}.<br>Utilisez l'onglet <b>+ Nouvelle</b> pour en enregistrer une.</div>`;
}

let fDepSel="";
function renderFoyers(){
  const deps=[...new Set(DB.foyers.map(f=>f.dept||(f.dept=deptOf(f.lat,f.lon))))].sort();
  $("fDepChips").innerHTML=[`<span class="chip ${!fDepSel?"on":""}" onclick="setFDep('')">Tous (${DB.foyers.length})</span>`].concat(deps.map(d=>`<span class="chip ${fDepSel===d?"on":""}" onclick="setFDep('${esc(d).replace(/'/g,"\\'")}')">${esc(d)} (${DB.foyers.filter(f=>f.dept===d).length})</span>`)).join("");
  const list=DB.foyers.filter(f=>!fDepSel||f.dept===fDepSel);
  $("foyerList").innerHTML=list.length?list.map(f=>{const n=DB.alerts.filter(a=>km(a.lat,a.lon,f.lat,f.lon)<PROX_KM).length;
    return `<div class="card" style="border-left-color:#7f0000" onclick="focusFoyer('${f.id}')"><h4><span class="t">${esc(f.zone)}</span></h4>
    <div class="meta">${esc(f.dept)} · Chef : ${esc((f.chef||"—").split(" — ")[0])}</div>
    <div class="badges">${(f.cats||[]).map(k=>`<span class="bdg out">${esc(FCATS[k]||k)}</span>`).join("")}${n?`<span class="bdg prox">${n} alerte(s) à &lt; ${PROX_KM} km</span>`:""}</div></div>`;}).join("")
    :`<div class="empty">Aucun foyer enregistré.</div>`;
}
window.setFDep=d=>{fDepSel=d;renderFoyers();};

function bars(el,data,colorFn){const max=Math.max(1,...data.map(d=>d[1]));
  $(el).innerHTML=data.length?data.map(([k,v])=>`<div class="row"><span class="lbl" title="${esc(k)}">${esc(k)}</span><span class="bar"><i style="width:${v/max*100}%;background:${colorFn(k)}"></i></span><span class="v">${v}</span></div>`).join(""):`<div class="hint">Aucune donnée.</div>`;}

function renderDash(){
  const A=DB.alerts,now=Date.now();
  $("kTot").textContent=A.length;
  $("k24").textContent=A.filter(a=>now-new Date(a.date)<86400000).length;
  $("kCrit").textContent=A.filter(a=>["critique","elevee"].includes(a.grav)&&!["traitee","fausse"].includes(a.stat)).length;
  $("kProx").textContent=A.filter(a=>{const p=proxInfo(a);return p&&p.d<PROX_KM;}).length;
  bars("byCat",Object.entries(CATS).map(([k,c])=>[c.short,A.filter(a=>a.cat===k).length]),k=>Object.values(CATS).find(c=>c.short===k).color);
  bars("byDep",DEPT_NAMES.map(d=>[d,A.filter(a=>a.dept===d).length]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]),()=>"#16365f");
  bars("byDepF",DEPT_NAMES.map(d=>[d,DB.foyers.filter(f=>f.dept===d).length]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]),()=>"#7f0000");
  $("cA").textContent=A.length;$("cF").textContent=DB.foyers.length;$("cZ").textContent=DB.zones.length;
  $("kZR").textContent=DB.zones.filter(z=>z.level==="rouge").length;
  $("kHS").textContent=detectHotspots(30,+$("aEps").value||2,+$("aMin").value||3).length;
}
function renderAll(){if(typeof renderBases==="function")try{renderBases();}catch(e){}try{updateDemoBadge();}catch(e){}setTimeout(()=>{try{renderCmd();}catch(e){}},0);DB.zones.forEach(z=>{if(!z.dept){const c=polyCentroid(z.coords);z.dept=deptOf(c[0],c[1]);}});renderZones();renderAnalysis();if(typeof fillPlaces==="function")fillPlaces();DB.foyers.forEach(f=>{if(!f.dept)f.dept=deptOf(f.lat,f.lon);});renderMap();renderList();renderFoyers();renderDash();}

/* ===================== Actions ===================== */
function highlight(id){document.querySelectorAll(".card.active").forEach(e=>e.classList.remove("active"));const c=$("c-"+id);if(c){c.classList.add("active");c.scrollIntoView({block:"nearest",behavior:"smooth"});}}
window.focusAlert=id=>{const m=markers[id];if(!m)return;highlight(id);alertLayer.zoomToShowLayer(m,()=>{map.setView(m.getLatLng(),Math.max(map.getZoom(),14));m.openPopup();});};
window.focusFoyer=id=>{const f=DB.foyers.find(x=>x.id===id);if(!f)return;if(!map.hasLayer(foyerLayer))foyerLayer.addTo(map);map.flyTo([f.lat,f.lon],13,{duration:.8});
  setTimeout(()=>foyerLayer.eachLayer(l=>{if(l.getPopup&&l.getPopup()&&l.options.title===f.zone)l.openPopup();}),850);};
window.setStat=(id,v)=>{const a=DB.alerts.find(x=>x.id===id);if(!a)return;a.stat=v;a.updated=new Date().toISOString();save();map.closePopup();renderAll();toast("Statut mis à jour : "+STAT[v].label);};
window.delAlert=id=>{askConfirm("Supprimer définitivement l'alerte "+id+" ?").then(ok=>{if(!ok)return;DB.alerts=DB.alerts.filter(x=>x.id!==id);save();map.closePopup();renderAll();toast("Alerte supprimée");});};
window.delFoyer=id=>{const f=DB.foyers.find(x=>x.id===id);if(!f)return;askConfirm("Retirer le foyer « "+f.zone+" » de la carte ?").then(ok=>{if(!ok)return;DB.foyers=DB.foyers.filter(x=>x.id!==id);save();map.closePopup();renderAll();toast("Foyer retiré");});};
window.filterDept=d=>{map.closePopup();F.dep=d;$("fDep").value=d;showTab("alerts");renderMap();renderList();};

// Onglets
function showTab(t){document.querySelectorAll(".tab").forEach(e=>e.classList.toggle("on",e.dataset.t===t));document.querySelectorAll(".pane").forEach(e=>e.classList.toggle("on",e.id==="p-"+t));}
document.querySelectorAll(".tab").forEach(e=>e.onclick=()=>showTab(e.dataset.t));

// Filtres
$("catChips").innerHTML=Object.entries(CATS).map(([k,c])=>`<span class="chip" data-k="${k}"><i style="background:${c.color}"></i>${c.short}</span>`).join("");
$("catChips").onclick=e=>{const ch=e.target.closest(".chip");if(!ch)return;const k=ch.dataset.k;F.cats.has(k)?F.cats.delete(k):F.cats.add(k);ch.classList.toggle("on");renderMap();renderList();};
fillSel($("fGrav"),GRAV,"Toute gravité");fillSel($("fStat"),STAT,"Tout statut");
$("fDep").innerHTML=`<option value="">Tous les départements</option>`+DEPT_NAMES.map(d=>`<option>${esc(d)}</option>`).join("");
[["fGrav","grav"],["fStat","stat"],["fPer","per"],["fDep","dep"]].forEach(([id,k])=>$(id).onchange=e=>{F[k]=e.target.value;renderMap();renderList();});
$("q").oninput=e=>{F.q=e.target.value.trim().toLowerCase();renderMap();renderList();};

/* ===================== Saisie de position ===================== */
function fillPlaces(){$("places").innerHTML=PLACES.map(p=>`<option value="${esc(p[0])} (${esc(p[1])})">`).join("")+DB.foyers.map(f=>`<option value="${esc(f.zone)} (${esc(f.dept||deptOf(f.lat,f.lon))})">`).join("");}
fillPlaces();
function placeLookup(v){v=(v||"").trim();if(!v)return null;
  const p=PLACES.find(p=>`${p[0]} (${p[1]})`===v);if(p)return {lat:p[2],lon:p[3],name:p[0]};
  const f=DB.foyers.find(f=>`${f.zone} (${f.dept||"Nord"})`===v||alnum(f.zone)===alnum(v));if(f)return {lat:f.lat,lon:f.lon,name:f.zone};
  const k=alnum(v.replace(/\s*\([^)]*\)\s*$/,""));
  const q=PLACES.find(p=>alnum(p[0])===k)||PLACES.find(p=>alnum(p[0]).startsWith(k))||PLACES.find(p=>alnum(p[0]).includes(k));
  return q?{lat:q[2],lon:q[3],name:q[0]}:null;}

let pick=null,tmp=null;
const N={lat:null,lon:null,place:""}, FF={lat:null,lon:null};
function setTmp(lat,lon){if(tmp)map.removeLayer(tmp);tmp=L.marker([lat,lon],{draggable:true,icon:L.divIcon({className:"",html:'<div class="tmp"></div>',iconSize:[22,22],iconAnchor:[11,11]}),zIndexOffset:1000}).addTo(map);
  tmp.on("dragend",()=>{const ll=tmp.getLatLng();pickDispatch(tmp._for==="foyer"?"foyer":tmp._for==="base"?"base":"alert",ll.lat,ll.lng);});}
function pickDispatch(k,lat,lng){if(k==="alert")setNPos(lat,lng,true);else if(k==="base")setBPos(lat,lng,true);else setFPos(lat,lng,true);}
function setNPos(lat,lon,fromMap,name){N.lat=+lat;N.lon=+lon;$("nLat").value=N.lat.toFixed(5);$("nLon").value=N.lon.toFixed(5);
  const dep=deptOf(N.lat,N.lon);const np=nearestPlace(N.lat,N.lon);
  if(name){N.place=name;} else if(fromMap||!N.place){N.place=np?(np.d<1.5?np.p[0]:`près de ${np.p[0]} (${np.d.toFixed(1)} km)`):"";}
  const nf=nearestFoyer(N.lat,N.lon);
  $("nPos").innerHTML=dep?`✔ ${esc(N.place)} · <b>${esc(dep)}</b>${nf?`<br><span style="color:${nf.d<PROX_KM?"#b34700":"#5f6b7d"}">${nf.d<PROX_KM?"⚠ ":""}Foyer le plus proche : ${esc(nf.f.zone)} (${nf.d.toFixed(1)} km)</span>`:""}`:`<span style="color:#c62828">⚠ Position hors d'Haïti ?</span>`;
  setTmp(N.lat,N.lon);tmp._for="alert";if(!fromMap)map.setView([N.lat,N.lon],Math.max(map.getZoom(),12));}
function setFPos(lat,lon,fromMap){FF.lat=+lat;FF.lon=+lon;const dep=deptOf(FF.lat,FF.lon);$("ffPos").textContent=`✔ ${FF.lat.toFixed(5)}, ${FF.lon.toFixed(5)} · ${dep||"hors d'Haïti ?"}`;setTmp(FF.lat,FF.lon);tmp._for="foyer";if(!fromMap)map.setView([FF.lat,FF.lon],Math.max(map.getZoom(),12));}
function startPick(kind){pick=kind;$("map").classList.add("picking");$("pickbar").classList.add("on");map.closePopup();}
function stopPick(){pick=null;$("map").classList.remove("picking");$("pickbar").classList.remove("on","draw");$("pickTxt").textContent="📍 Cliquez sur la carte pour placer le point";map.doubleClickZoom.enable();}
$("pickCancel").onclick=()=>{const wasDraw=pick==="zone";stopPick();if(wasDraw)clearDraft();};
$("pickDone").onclick=()=>finishDraw();
map.on("click",e=>{if(!pick)return;if(pick==="zone"){addVertex(e.latlng);return;}const k=pick;stopPick();pickDispatch(k,e.latlng.lat,e.latlng.lng);});
$("nPick").onclick=()=>startPick("alert");
$("ffPick").onclick=()=>startPick("foyer");
$("nGps").onclick=()=>{if(!navigator.geolocation)return toast("Géolocalisation non disponible sur cet appareil");toast("Recherche de votre position…");
  navigator.geolocation.getCurrentPosition(p=>{$("nPrec").value="exacte";setNPos(p.coords.latitude,p.coords.longitude,false);},()=>toast("Position refusée ou indisponible"),{enableHighAccuracy:true,timeout:10000});};
$("nPlace").onchange=e=>{const r=placeLookup(e.target.value);if(r){$("nPrec").value="approx";setNPos(r.lat,r.lon,false,r.name);}else toast("Localité introuvable : placez le point sur la carte");};
$("ffPlace").onchange=e=>{const r=placeLookup(e.target.value);if(r)setFPos(r.lat,r.lon,false);else toast("Localité introuvable : placez le point sur la carte");};
["nLat","nLon"].forEach(id=>$(id).onchange=()=>{const a=parseFloat($("nLat").value.replace(",",".")),b=parseFloat($("nLon").value.replace(",","."));if(isFinite(a)&&isFinite(b))setNPos(a,b,true);});

/* ===================== Nouvelle alerte ===================== */
fillSel($("nCat"),CATS);fillSel($("nGrav"),GRAV);$("nGrav").value="moyenne";
$("nSrc").innerHTML=SRCS.map(s=>`<option>${esc(s)}</option>`).join("");
function resetNew(){["nTitle","nLink","nDesc","nPlace","nLat","nLon"].forEach(i=>$(i).value="");$("nDate").value=localISO(new Date());$("nPos").innerHTML="";N.lat=N.lon=null;N.place="";$("nPrec").value="exacte";if(tmp){map.removeLayer(tmp);tmp=null;}}
resetNew();
$("nReset").onclick=resetNew;
$("nSave").onclick=()=>{
  const title=$("nTitle").value.trim();
  if(!title)return toast("Indiquez un titre"),$("nTitle").focus();
  if(N.lat==null)return toast("Indiquez la localisation (carte, localité ou coordonnées)");
  const a={id:nextId(),title,cat:$("nCat").value,grav:$("nGrav").value,stat:"nouvelle",date:new Date($("nDate").value||Date.now()).toISOString(),
    src:$("nSrc").value,link:$("nLink").value.trim(),desc:$("nDesc").value.trim(),lat:N.lat,lon:N.lon,prec:$("nPrec").value,place:N.place,dept:deptOf(N.lat,N.lon),created:new Date().toISOString()};
  DB.alerts.push(a);save();resetNew();renderAll();showTab("alerts");setTimeout(()=>focusAlert(a.id),150);
  const p=proxInfo(a);toast(`Alerte ${a.id} enregistrée`+(p&&p.d<PROX_KM?` — ⚠ à ${p.d.toFixed(1)} km du foyer « ${p.f.zone} »`:""));};

/* ===================== Nouveau foyer ===================== */
$("ffCats").innerHTML=Object.entries(FCATS).map(([k,v])=>`<span class="chip" data-k="${k}">${v}</span>`).join("");
$("ffCats").onclick=e=>{const c=e.target.closest(".chip");if(c)c.classList.toggle("on");};
$("bNewF").onclick=()=>{$("fForm").style.display="block";$("ffZone").focus();};
$("ffCancel").onclick=()=>{$("fForm").style.display="none";if(tmp){map.removeLayer(tmp);tmp=null;}};
$("ffSave").onclick=()=>{const zone=$("ffZone").value.trim();if(!zone)return toast("Indiquez la zone");if(FF.lat==null)return toast("Placez le foyer sur la carte ou choisissez une localité");
  const f={id:"F-"+Date.now().toString(36).toUpperCase(),zone,chef:$("ffChef").value.trim(),membres:$("ffMem").value.trim(),act:$("ffAct").value.trim(),
    cats:[...document.querySelectorAll("#ffCats .chip.on")].map(c=>c.dataset.k),rad:parseFloat($("ffRad").value)||1.5,src:$("ffSrc").value.trim(),lat:FF.lat,lon:FF.lon,dept:deptOf(FF.lat,FF.lon),approx:false};
  DB.foyers.push(f);save();["ffZone","ffChef","ffMem","ffAct","ffSrc","ffPlace"].forEach(i=>$(i).value="");$("ffPos").textContent="";FF.lat=FF.lon=null;
  document.querySelectorAll("#ffCats .chip.on").forEach(c=>c.classList.remove("on"));$("fForm").style.display="none";if(tmp){map.removeLayer(tmp);tmp=null;}
  renderAll();focusFoyer(f.id);toast("Foyer ajouté");};

/* ===================== Export / import ===================== */
function download(name,data,type){
  if(HOSTED){ if(!DLCAP){toast("Téléchargement indisponible dans ce lien : utilisez la version installée.");return;}
    DLCAP.save({filename:name.replace(/\.geojson$/,".json"),data:new Blob([data],{type})}).then(()=>toast("Fichier enregistré"),e=>{if(e&&e.code!=="declined")toast("Téléchargement impossible ici ("+(e.code||"erreur")+")");});return;}
const b=new Blob([data],{type});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);}
const stamp=()=>new Date().toISOString().slice(0,16).replace(/[:T]/g,"-");
const COLS=["id","titre","categorie","gravite","statut","date","latitude","longitude","precision","localite","departement","source","lien","description","foyer_proche","distance_km"];
$("bExpCsv").onclick=()=>{const q=v=>{v=String(v??"");return /[;"\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
  const rows=DB.alerts.map(a=>{const p=proxInfo(a);return [a.id,a.title,CATS[a.cat]?.short,GRAV[a.grav]?.label,STAT[a.stat]?.label,fmtDate(a.date),a.lat.toFixed(6).replace(".",","),a.lon.toFixed(6).replace(".",","),a.prec==="approx"?"Approximative":"Exacte",a.place,a.dept,a.src,a.link,a.desc,p?p.f.zone:"",p?p.d.toFixed(2).replace(".",","):""].map(q).join(";");});
  download(`${CFG.sigle}_alertes_${stamp()}.csv`,"﻿"+COLS.join(";")+"\r\n"+rows.join("\r\n"),"text/csv;charset=utf-8");toast("Fichier CSV téléchargé (s'ouvre dans Excel)");};
$("bExpJson").onclick=()=>{download(`${CFG.sigle}_sauvegarde_${stamp()}.json`,JSON.stringify({app:"DCPJ-cartographie",version:1,exported:new Date().toISOString(),...DB},null,1),"application/json");toast("Sauvegarde téléchargée");};
$("bExpGeo").onclick=()=>{const feats=[];
  DB.zones.forEach(z=>feats.push({type:"Feature",properties:{couche:"zone_insecurite",id:z.id,nom:z.name,niveau:ZLEV[z.level].short,type:z.type,description:z.desc,source:z.src,date:z.date,departement:z.dept,superficie_km2:+polyAreaKm2(z.coords).toFixed(2)},geometry:{type:"Polygon",coordinates:[z.coords.concat([z.coords[0]]).map(c=>[c[1],c[0]])]}}));
  (DB.bases||[]).forEach(b=>feats.push({type:"Feature",properties:{couche:"point_depart",id:b.id,nom:b.name,type:BASE_TYPES[b.type]?.label,departement:b.dept},geometry:{type:"Point",coordinates:[b.lon,b.lat]}}));
  DB.foyers.forEach(f=>feats.push({type:"Feature",properties:{couche:"foyer_gang",id:f.id,zone:f.zone,chef:f.chef,membres:f.membres,activites:f.act,departement:f.dept,rayon_km:f.rad,source:f.src},geometry:{type:"Point",coordinates:[f.lon,f.lat]}}));
  DB.alerts.forEach(a=>feats.push({type:"Feature",properties:{couche:"alerte",id:a.id,titre:a.title,categorie:CATS[a.cat]?.short,gravite:GRAV[a.grav]?.label,statut:STAT[a.stat]?.label,date:a.date,localite:a.place,departement:a.dept,source:a.src},geometry:{type:"Point",coordinates:[a.lon,a.lat]}}));
  HOTS.forEach(h=>feats.push({type:"Feature",properties:{couche:"foyer_violence_detecte",id:h.id,alertes:h.n,score:h.score,localite:h.place,departement:h.dept,rayon_km:+h.r.toFixed(2)},geometry:{type:"Point",coordinates:[h.lon,h.lat]}}));
  download(`${CFG.sigle}_SIG_${stamp()}.geojson`,JSON.stringify({type:"FeatureCollection",name:"cartographie_insecurite",features:feats}),"application/geo+json");toast("Fichier GeoJSON téléchargé (QGIS, ArcGIS, Google Earth Pro…)");};
$("bImp").onclick=()=>$("fImp").click();
function parseCSV(t){const sep=(t.split(/\r?\n/)[0].match(/;/g)||[]).length>=(t.split(/\r?\n/)[0].match(/,/g)||[]).length?";":",";const rows=[];let r=[],v="",q=false;
  for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c==='"'){if(t[i+1]==='"'){v+='"';i++;}else q=false;}else v+=c;}
    else if(c==='"')q=true;else if(c===sep){r.push(v);v="";}else if(c==="\n"||c==="\r"){if(c==="\r"&&t[i+1]==="\n")i++;r.push(v);rows.push(r);r=[];v="";}else v+=c;}
  if(v||r.length){r.push(v);rows.push(r);}return rows.filter(r=>r.some(x=>x.trim()));}
function matchKey(obj,v){v=norm(v);if(!v)return null;for(const [k,o] of Object.entries(obj)){if(norm(k)===v||norm(o.label||o)===v||norm(o.short||"")===v||norm(o.label||o).startsWith(v)||v.startsWith(norm(o.short||o.label||o)))return k;}return null;}
$("fImp").onchange=async e=>{const file=e.target.files[0];e.target.value="";if(!file)return;const txt=(await file.text()).replace(/^﻿/,"");
  try{
    if(/^\s*[{\[]/.test(txt)){const d=JSON.parse(txt);const al=Array.isArray(d)?d:d.alerts||[];let na=0,nf=0;
      const ids=new Set(DB.alerts.map(a=>a.id));al.forEach(a=>{if(a&&isFinite(a.lat)&&isFinite(a.lon)&&!ids.has(a.id)){if(!a.id)a.id=nextId();if(!a.dept)a.dept=deptOf(a.lat,a.lon);DB.alerts.push(a);na++;}});
      if(d.foyers){const fids=new Set(DB.foyers.map(f=>f.id));d.foyers.forEach(f=>{if(f&&isFinite(f.lat)&&!fids.has(f.id)){DB.foyers.push(f);nf++;}});}
      if(Array.isArray(d.bases)){const bids=new Set(DB.bases.map(b=>b.id));d.bases.forEach(b=>{if(b&&isFinite(b.lat)&&!bids.has(b.id))DB.bases.push(b);});}
      if(Array.isArray(d.zones)){const zids=new Set(DB.zones.map(z=>z.id));d.zones.forEach(z=>{if(z&&Array.isArray(z.coords)&&z.coords.length>=3&&!zids.has(z.id)){DB.zones.push(z);}});}
      if(d.seq&&d.seq>DB.seq)DB.seq=d.seq;save();renderAll();toast(`${na} alerte(s) et ${nf} foyer(s) importés`);return;}
    const rows=parseCSV(txt);const h=rows.shift().map(norm);const col=n=>h.findIndex(x=>n.some(y=>x===y||x.startsWith(y)));
    const c={t:col(["titre","title"]),cat:col(["categorie","category"]),g:col(["gravite","severity"]),s:col(["statut","status"]),d:col(["date"]),la:col(["latitude","lat"]),lo:col(["longitude","lon","lng"]),
      pl:col(["localite","lieu","place"]),src:col(["source"]),ln:col(["lien","link","url"]),de:col(["description","desc"]),id:col(["id"])};
    let n=0,skip=0;const ids=new Set(DB.alerts.map(a=>a.id));
    rows.forEach(r=>{const g=i=>i>=0?(r[i]||"").trim():"";let lat=parseFloat(g(c.la).replace(",",".")),lon=parseFloat(g(c.lo).replace(",","."));let place=g(c.pl),prec="exacte";
      if(!(isFinite(lat)&&isFinite(lon))){const p=placeLookup(place);if(p){lat=p.lat;lon=p.lon;prec="approx";}}
      if(!(isFinite(lat)&&isFinite(lon))||!g(c.t)){skip++;return;}
      if(g(c.id)&&ids.has(g(c.id))){skip++;return;}
      let dt=new Date(g(c.d));if(isNaN(dt)){const m=g(c.d).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\D+(\d{1,2}):(\d{2}))?/);dt=m?new Date(+m[3],m[2]-1,+m[1],+(m[4]||0),+(m[5]||0)):new Date();}
      DB.alerts.push({id:g(c.id)||nextId(),title:g(c.t),cat:matchKey(CATS,g(c.cat))||"autre",grav:matchKey(GRAV,g(c.g))||"moyenne",stat:matchKey(STAT,g(c.s))||"nouvelle",date:dt.toISOString(),
        src:g(c.src)||"Import",link:g(c.ln),desc:g(c.de),lat,lon,prec,place:place||(nearestPlace(lat,lon)?.p[0]||""),dept:deptOf(lat,lon),created:new Date().toISOString()});n++;});
    save();renderAll();toast(`${n} alerte(s) importée(s)`+(skip?`, ${skip} ligne(s) ignorée(s)`:""));
  }catch(err){toast("Fichier illisible : "+err.message);}
};

/* ===================== Démonstration ===================== */
/* Groupes armés FICTIFS pour la démonstration (aucune donnée réelle) */
function addDemoFoyers(){if(DB.foyers.some(f=>f.demo))return;
  const D=[["Croix-des-Bouquets","A",["vol","enlev","taxe"],2.5],["Port-au-Prince","B",["enlev","assassinat","drogue"],2],["Saint-Marc","C",["vol","taxe"],1.8],
           ["Mirebalais","D",["vol","foncier"],1.5],["Cap-Haïtien","E",["foncier","vol"],1.5],["Limonade","F",["foncier"],1.2],["Gonaïves","G",["drogue","vol"],1.5]];
  D.forEach(([pl,l,cats,rad],i)=>{const r=placeLookup(pl);if(!r)return;const lat=r.lat+.012*Math.cos(i),lon=r.lon+.012*Math.sin(i);
    DB.foyers.push({id:"F-DEMO-"+l,zone:"[DÉMO] Groupe armé fictif "+l+" – "+r.name,lat,lon,dept:deptOf(lat,lon),chef:"— (donnée fictive)",membres:"— (donnée fictive)",
      act:"Exemple fictif utilisé pour la démonstration du logiciel.",cats,rad,src:"Démonstration",approx:true,demo:true});});}
function updateDemoBadge(){const on=DB.alerts.some(a=>a.demo)||DB.zones.some(z=>z.demo)||DB.foyers.some(f=>f.demo)||(DB.bases||[]).some(b=>b.demo);
  const p=document.getElementById("demoPill");if(p)p.style.display=on?"":"none";
  document.querySelectorAll(".c-class").forEach(e=>e.textContent=on?"DÉMONSTRATION · DONNÉES FICTIVES · "+CFG.classification:CFG.classification);}
$("bDemo").onclick=()=>{addDemoFoyers();if(typeof addDemoBases==="function")addDemoBases();
  const S=[["Publication avec fusils d'assaut exhibés","armes","elevee","Cap-Haitien"],["Signalement d'enlèvement sur la RN1","enlev","critique","Limbe"],["Vente de stupéfiants annoncée sur WhatsApp","drogue","moyenne","Port-au-Prince"],
    ["Vidéo d'un gang revendiquant une attaque","gang","critique","Croix des Bouquets"],["Appel : coups de feu près du marché","armes","elevee","Saint-Marc"],["Agression sexuelle signalée","viol","elevee","Gonaives"],
    ["Barrage armé, taxation des passants","gang","elevee","Milot"],["Menaces publiées contre des habitants","gang","moyenne","Limonade"],["Annonce de vente d'armes","armes","critique","Petion-Ville"],
    ["Enlèvement d'un commerçant","enlev","critique","Mirebalais"],["Point de vente de drogue signalé","drogue","faible","Les Cayes"],["Déchoukage de terrain en cours","gang","moyenne","Quartier Morin"],
    ["Publication incitant à la violence","autre","faible","Jacmel"],["Individus armés aperçus","armes","moyenne","Fort Liberte"],["Tentative d'enlèvement","enlev","elevee","Port-de-Paix"]];
  const st=["nouvelle","verif","confirmee","traitee","nouvelle"];let n=0;
  S.forEach((s,i)=>{const r=placeLookup(s[3]);if(!r)return;const p=[r.name,"",r.lat,r.lon];const j=()=>(Math.random()-.5)*.03;
    const lat=p[2]+j(),lon=p[3]+j();
    DB.alerts.push({id:nextId(),title:"[DÉMO] "+s[0],cat:s[1],grav:s[2],stat:st[i%5],date:new Date(Date.now()-Math.random()*20*86400000).toISOString(),src:SRCS[i%SRCS.length],link:"",desc:"Alerte fictive créée pour tester l'application.",lat,lon,prec:"approx",place:p[0],dept:deptOf(lat,lon),demo:true,created:new Date().toISOString()});n++;});
  // grappes autour de quelques points chauds fictifs, pour illustrer la détection automatique
  const G=[["Croix-des-Bouquets",7,["gang","enlev","armes"]],["Port-au-Prince",8,["armes","gang","enlev","drogue"]],["Cap-Haïtien",5,["armes","drogue","gang"]],["Milot",4,["gang","viol","armes"]],["Saint-Marc",4,["enlev","armes"]]];
  const T={gang:"Mouvement d'hommes armés signalé",enlev:"Signalement d'enlèvement",armes:"Coups de feu entendus",drogue:"Point de vente de drogue",viol:"Agression sexuelle signalée"};
  G.forEach(([pl,k,cs],gi)=>{const r=placeLookup(pl);if(!r)return;for(let i=0;i<k;i++){const lat=r.lat+(Math.random()-.5)*.022,lon=r.lon+(Math.random()-.5)*.022,c=cs[i%cs.length];
    DB.alerts.push({id:nextId(),title:"[DÉMO] "+T[c],cat:c,grav:["moyenne","elevee","critique"][(i+gi)%3],stat:["nouvelle","verif","confirmee"][i%3],date:new Date(Date.now()-Math.random()*(i<k/2?6:25)*86400000).toISOString(),src:SRCS[(i+gi)%SRCS.length],link:"",desc:"Alerte fictive créée pour tester l'application.",lat,lon,prec:"approx",place:r.name,dept:deptOf(lat,lon),demo:true,created:new Date().toISOString()});n++;}});
  const Z=[["[DÉMO] Zone fictive – Croix-des-Bouquets","rouge",ZTYPES[0],"Croix-des-Bouquets",.035],["[DÉMO] Zone fictive – Route nationale 1 (Saint-Marc)","orange",ZTYPES[1],"Saint-Marc",.03],["[DÉMO] Zone fictive – Milot","jaune",ZTYPES[4],"Milot",.025]];
  Z.forEach(([nm,lv,ty,pl,s])=>{const r=placeLookup(pl);if(!r)return;const coords=[];for(let i=0;i<7;i++){const an=i/7*2*Math.PI,k=s*(.75+Math.random()*.5);coords.push([+(r.lat+k*Math.sin(an)).toFixed(5),+(r.lon+k*1.1*Math.cos(an)).toFixed(5)]);}
    const c=polyCentroid(coords);DB.zones.push({id:"Z-"+Date.now().toString(36).toUpperCase()+Math.floor(Math.random()*1e3),name:nm,level:lv,type:ty,desc:"Zone fictive créée pour tester l'application.",src:"Démonstration",date:new Date().toISOString().slice(0,10),coords,dept:deptOf(c[0],c[1]),demo:true});});
  save();renderAll();map.fitBounds(HT_BOUNDS);toast(n+" alertes et 3 zones de démonstration ajoutées (marquées DÉMO)");};
$("bDemoDel").onclick=()=>{const n=DB.alerts.filter(a=>a.demo).length,nz=DB.zones.filter(z=>z.demo).length;DB.alerts=DB.alerts.filter(a=>!a.demo);DB.zones=DB.zones.filter(z=>!z.demo);DB.foyers=DB.foyers.filter(f=>!f.demo);DB.bases=(DB.bases||[]).filter(b=>!b.demo);save();renderAll();toast(`${n} alerte(s) et ${nz} zone(s) de démo retirées`);};

/* ===================== Zones d'insécurité ===================== */
let draft={pts:[],shape:null,vx:L.layerGroup().addTo(map)};
function clearDraft(){draft.pts=[];if(draft.shape){map.removeLayer(draft.shape);draft.shape=null;}draft.vx.clearLayers();}
function redrawDraft(){if(draft.shape)map.removeLayer(draft.shape);const lv=$("zLevel").value||"rouge",col=ZLEV[lv].color;
  draft.shape=(draft.pts.length>=3?L.polygon(draft.pts,{color:col,weight:2.5,fillColor:col,fillOpacity:.25,dashArray:"6 4",interactive:false}):L.polyline(draft.pts,{color:col,weight:2.5,dashArray:"6 4",interactive:false})).addTo(map);
  draft.vx.clearLayers();draft.pts.forEach(p=>L.marker(p,{icon:L.divIcon({className:"",html:'<div class="vx"></div>',iconSize:[12,12],iconAnchor:[6,6]}),interactive:false}).addTo(draft.vx));}
function addVertex(ll){draft.pts.push([+ll.lat.toFixed(5),+ll.lng.toFixed(5)]);redrawDraft();$("pickTxt").textContent=`✏ ${draft.pts.length} point(s) — continuez, puis « Terminer »`;}
$("bDraw").onclick=()=>{clearDraft();$("zForm").style.display="none";pick="zone";$("map").classList.add("picking");$("pickbar").classList.add("on","draw");$("pickTxt").textContent="✏ Cliquez sur la carte pour poser les sommets de la zone";map.doubleClickZoom.disable();map.closePopup();};
map.on("dblclick",e=>{if(pick==="zone"){L.DomEvent.stop(e);finishDraw();}});
function finishDraw(){if(draft.pts.length>=2&&pick==="zone"){/* un double-clic ajoute deux points identiques : on dédoublonne */
    draft.pts=draft.pts.filter((p,i,a)=>i===0||km(p[0],p[1],a[i-1][0],a[i-1][1])>0.01);}
  if(draft.pts.length<3)return toast("Il faut au moins 3 points pour fermer la zone");
  stopPick();redrawDraft();const c=polyCentroid(draft.pts),dep=deptOf(c[0],c[1]);
  const inside=DB.alerts.filter(a=>inPoly(a.lat,a.lon,draft.pts)).length,fo=DB.foyers.filter(f=>inPoly(f.lat,f.lon,draft.pts)).length;
  $("zInfo").innerHTML=`✔ ${esc(dep||"?")} · ${polyAreaKm2(draft.pts).toFixed(1)} km² · ${inside} alerte(s) et ${fo} foyer(s) de gang à l'intérieur`;
  $("zDate").value=new Date().toISOString().slice(0,10);$("zForm").style.display="block";showTab("zones");$("zName").focus();}
fillSel($("zLevel"),ZLEV);$("zType").innerHTML=ZTYPES.map(t=>`<option>${esc(t)}</option>`).join("");
$("zLevel").onchange=()=>{if(draft.pts.length)redrawDraft();};
$("zCancel").onclick=()=>{clearDraft();$("zForm").style.display="none";};
$("zSave").onclick=()=>{const name=$("zName").value.trim();if(!name)return toast("Donnez un nom à la zone");if(draft.pts.length<3)return toast("Délimitez d'abord la zone sur la carte");
  const c=polyCentroid(draft.pts);const z={id:"Z-"+Date.now().toString(36).toUpperCase(),name,level:$("zLevel").value,type:$("zType").value,desc:$("zDesc").value.trim(),src:$("zSrc").value.trim(),date:$("zDate").value,coords:draft.pts.slice(),dept:deptOf(c[0],c[1]),created:new Date().toISOString()};
  DB.zones.push(z);save();clearDraft();["zName","zDesc","zSrc"].forEach(i=>$(i).value="");$("zForm").style.display="none";renderAll();focusZone(z.id);toast("Zone enregistrée");};
function zonePopup(z){const L_=ZLEV[z.level];const inside=DB.alerts.filter(a=>inPoly(a.lat,a.lon,z.coords));const fo=DB.foyers.filter(f=>inPoly(f.lat,f.lon,z.coords));
  return `<div class="pp"><h3>${esc(z.name)}</h3><div class="m">${esc(z.dept||"?")} · ${polyAreaKm2(z.coords).toFixed(2)} km² · périmètre ${zonePerimKm(z.coords).toFixed(1)} km · évaluée le ${esc(z.date||"—")}</div>
  <div class="badges"><span class="bdg" style="background:${L_.color};color:${z.level==="jaune"?"#3a2d00":"#fff"}">${L_.label}</span>${z.demo?'<span class="bdg out">DÉMO</span>':""}</div>
  <dl><dt>Type</dt><dd>${esc(z.type||"—")}</dd>${z.desc?`<dt>Description / consignes</dt><dd>${esc(z.desc)}</dd>`:""}
  <dt>À l'intérieur</dt><dd>${inside.length} alerte(s) (${inside.filter(a=>a.grav==="critique").length} critique(s)) · ${fo.length} foyer(s) de gang</dd>
  <dt>Source</dt><dd>${esc(z.src||"—")}</dd></dl>
  <div class="act" style="flex-wrap:wrap"><button class="btn sm pri" onclick="open3DZone('${z.id}')">⛰ Vue 3D</button><button class="btn sm" onclick="openOpSheet('${z.id}')">📋 Fiche opération</button></div>
  <div class="act"><select onchange="setZoneLevel('${z.id}',this.value)">${Object.entries(ZLEV).map(([k,v])=>`<option value="${k}" ${k===z.level?"selected":""}>${v.short}</option>`).join("")}</select>
  <button class="btn sm danger" onclick="delZone('${z.id}')">Supprimer</button></div></div>`;}
let zSel="";
function renderZones(){
  zoneLayer.clearLayers();zoneLabels.clearLayers();
  DB.zones.slice().sort((a,b)=>LORD[b.level]-LORD[a.level]).forEach(z=>{const col=ZLEV[z.level].color;
    const pg=L.polygon(z.coords,{pane:"zonesPane",color:col,weight:2,opacity:.9,fillColor:col,fillOpacity:z.level==="rouge"?.28:.22,zoneId:z.id}).bindPopup(()=>zonePopup(z),{maxWidth:340});
    pg.on("click",e=>{if(pick){L.DomEvent.stop(e);pg.closePopup();if(pick==="zone")addVertex(e.latlng);else{const k=pick;stopPick();pickDispatch(k,e.latlng.lat,e.latlng.lng);}}});
    pg.addTo(zoneLayer);
    const c=polyCentroid(z.coords);L.tooltip({permanent:true,direction:"center",className:"zlabel",opacity:.95}).setLatLng(c).setContent(esc(z.name.replace(/^\[DÉMO\]\s*/,""))).addTo(zoneLabels);});
  updZoneLabels();
  const counts={rouge:0,orange:0,jaune:0};DB.zones.forEach(z=>counts[z.level]++);
  $("zChips").innerHTML=`<span class="chip ${!zSel?"on":""}" onclick="setZSel('')">Toutes (${DB.zones.length})</span>`+Object.entries(ZLEV).map(([k,v])=>`<span class="chip ${zSel===k?"on":""}" onclick="setZSel('${k}')"><i style="background:${v.color}"></i>${v.short} (${counts[k]})</span>`).join("");
  const list=DB.zones.filter(z=>!zSel||z.level===zSel).sort((a,b)=>LORD[a.level]-LORD[b.level]);
  $("zoneList").innerHTML=list.length?list.map(z=>{const n=DB.alerts.filter(a=>inPoly(a.lat,a.lon,z.coords)).length;
    return `<div class="card" style="border-left-color:${ZLEV[z.level].color}" onclick="focusZone('${z.id}')"><h4><span class="t">${esc(z.name)}</span></h4>
    <div class="meta">${esc(z.dept||"?")} · ${esc(z.type||"")} · ${polyAreaKm2(z.coords).toFixed(1)} km²</div>
    <div class="badges"><span class="bdg" style="background:${ZLEV[z.level].color};color:${z.level==="jaune"?"#3a2d00":"#fff"}">${ZLEV[z.level].short}</span><span class="bdg out">${n} alerte(s) à l'intérieur</span>${z.demo?'<span class="bdg out">DÉMO</span>':""}</div><div class="row-btns" style="margin-top:7px"><button class="btn sm" onclick="event.stopPropagation();open3DZone('${z.id}')">⛰ Vue 3D</button><button class="btn sm" onclick="event.stopPropagation();openOpSheet('${z.id}')">📋 Fiche opération</button></div></div>`;}).join("")
    :`<div class="empty">Aucune zone d'insécurité délimitée.<br>Cliquez sur <b>« Délimiter une zone »</b> puis dessinez-la sur la carte.</div>`;}
window.setZSel=k=>{zSel=k;renderZones();};
window.focusZone=id=>{const z=DB.zones.find(x=>x.id===id);if(!z)return;if(!map.hasLayer(zoneLayer))zoneLayer.addTo(map);map.flyToBounds(L.latLngBounds(z.coords).pad(.3),{duration:.8});
  setTimeout(()=>zoneLayer.eachLayer(l=>{if(l.options&&l.options.zoneId===id)l.openPopup();}),900);};
window.setZoneLevel=(id,v)=>{const z=DB.zones.find(x=>x.id===id);if(!z)return;z.level=v;z.updated=new Date().toISOString();save();map.closePopup();renderAll();toast("Niveau de la zone : "+ZLEV[v].short);};
window.delZone=id=>{const z=DB.zones.find(x=>x.id===id);if(!z)return;askConfirm("Supprimer la zone « "+z.name+" » ?").then(ok=>{if(!ok)return;DB.zones=DB.zones.filter(x=>x.id!==id);save();map.closePopup();renderAll();toast("Zone supprimée");});};

/* ===================== Analyse : foyers de violence & indice ===================== */
let HOTS=[];
function detectHotspots(days,eps,minPts){
  const now=Date.now();const P=DB.alerts.filter(a=>a.stat!=="fausse"&&(!days||now-new Date(a.date)<=days*86400000));
  const lab=new Array(P.length).fill(-2);let cid=0;   // -2 non visité, -1 bruit
  const nb=i=>{const r=[];for(let j=0;j<P.length;j++)if(km(P[i].lat,P[i].lon,P[j].lat,P[j].lon)<=eps)r.push(j);return r;};
  for(let i=0;i<P.length;i++){if(lab[i]!==-2)continue;const N=nb(i);if(N.length<minPts){lab[i]=-1;continue;}
    lab[i]=cid;const Q=N.filter(j=>j!==i);while(Q.length){const j=Q.shift();if(lab[j]===-1)lab[j]=cid;if(lab[j]!==-2)continue;lab[j]=cid;const N2=nb(j);if(N2.length>=minPts)Q.push(...N2);}cid++;}
  const out=[];for(let c=0;c<cid;c++){const M=P.filter((_,i)=>lab[i]===c);const lat=M.reduce((s,a)=>s+a.lat,0)/M.length,lon=M.reduce((s,a)=>s+a.lon,0)/M.length;
    const r=Math.max(.4,...M.map(a=>km(lat,lon,a.lat,a.lon)))+.3;const score=M.reduce((s,a)=>s+(GW[a.grav]||2),0);
    const cc={};M.forEach(a=>cc[a.cat]=(cc[a.cat]||0)+1);const cats=Object.entries(cc).sort((a,b)=>b[1]-a[1]);
    const w1=M.filter(a=>now-new Date(a.date)<=7*86400000).length,w0=M.filter(a=>{const d=now-new Date(a.date);return d>7*86400000&&d<=14*86400000;}).length;
    const np=nearestPlace(lat,lon),nf=nearestFoyer(lat,lon),z=worstZone(lat,lon);
    out.push({lat,lon,r,n:M.length,score,cats,ids:M.map(a=>a.id),trend:w1-w0,w1,w0,crit:M.filter(a=>a.grav==="critique").length,
      place:np?(np.d<2?np.p[0]:`près de ${np.p[0]}`):"",dept:deptOf(lat,lon),gang:nf&&nf.d<PROX_KM?nf:null,zone:z});}
  out.sort((a,b)=>b.score-a.score);out.forEach((h,i)=>h.id="FV-"+(i+1));return out;}
function hsColor(s){return s>=20?"#4a0072":s>=12?"#7a1fa2":s>=7?"#9c4dcc":"#ba68c8";}
function deptIndex(days){const now=Date.now();const raw={};DEPT_NAMES.forEach(d=>raw[d]={a:0,w:0,g:0,z:0,raw:0});
  DB.alerts.forEach(a=>{if(a.stat==="fausse"||!raw[a.dept])return;if(days&&now-new Date(a.date)>days*86400000)return;raw[a.dept].a++;raw[a.dept].w+=GW[a.grav]||2;});
  DB.foyers.forEach(f=>{if(raw[f.dept])raw[f.dept].g++;});
  DB.zones.forEach(z=>{if(raw[z.dept])raw[z.dept].z+=ZLEV[z.level].w;});
  let mx=0;for(const d in raw){const r=raw[d];r.raw=r.w+4*r.g+r.z;mx=Math.max(mx,r.raw);}
  for(const d in raw){raw[d].idx=mx?Math.round(100*raw[d].raw/mx):0;}return raw;}
function renderAnalysis(){
  const days=+$("aPer").value,eps=+$("aEps").value,mn=+$("aMin").value;$("hMin").textContent=mn;$("hEps").textContent=eps;
  IDX=deptIndex(days);idxLayer.setStyle(f=>{const v=(IDX[f.properties.name]||{}).idx||0;return {color:"#fff",weight:1.2,fillColor:idxCls(v).color,fillOpacity:.62};});
  const rows=Object.entries(IDX).sort((a,b)=>b[1].idx-a[1].idx);
  $("idxTable").innerHTML=rows.map(([d,v])=>{const c=idxCls(v.idx);return `<tr onclick="zoomDept('${esc(d).replace(/'/g,"\\'")}')"><td style="font-weight:600">${esc(d)}</td>
    <td style="width:34%"><div class="ib"><i style="width:${v.idx}%;background:${c.color}"></i></div></td><td style="text-align:right;font-weight:800;color:var(--navy)">${v.idx}</td>
    <td><span class="pill" style="background:${c.color};color:${v.idx>40?"#fff":"#3a2d00"}">${c.label}</span></td>
    <td class="meta" style="white-space:nowrap">${v.a} al. · ${v.g} gang(s) · ${DB.zones.filter(z=>z.dept===d).length} zone(s)</td></tr>`;}).join("");
  HOTS=detectHotspots(days,eps,mn);hotLayer.clearLayers();
  HOTS.forEach(h=>{const col=hsColor(h.score);
    L.circle([h.lat,h.lon],{radius:h.r*1000,color:col,weight:2,fillColor:col,fillOpacity:.18,dashArray:"2 5",interactive:false}).addTo(hotLayer);
    L.marker([h.lat,h.lon],{icon:L.divIcon({className:"",html:`<div class="hs" style="background:${col}">${h.id.replace("FV-","")}</div>`,iconSize:[30,30],iconAnchor:[15,15]}),zIndexOffset:500,title:"Foyer de violence "+h.id})
      .bindPopup(()=>hsPopup(h),{maxWidth:340}).addTo(hotLayer);});
  $("hsList").innerHTML=HOTS.length?HOTS.map(h=>`<div class="card" style="border-left-color:${hsColor(h.score)}" onclick="focusHS('${h.id}')">
     <h4><span class="hs" style="background:${hsColor(h.score)};width:24px;height:24px;font-size:10.5px;border-width:2px">${h.id.replace("FV-","")}</span><span class="t">${esc(h.place||"Foyer "+h.id)}</span></h4>
     <div class="meta">${esc(h.dept||"?")} · ${h.n} alertes · score ${h.score} · ${h.trend>0?`<b style="color:#c62828">▲ en hausse (+${h.trend})</b>`:h.trend<0?`<b style="color:#2e7d32">▼ en baisse (${h.trend})</b>`:"stable"}</div>
     <div class="badges">${h.cats.map(([k,n])=>`<span class="bdg" style="background:${(CATS[k]||CATS.autre).color}">${(CATS[k]||CATS.autre).short} ×${n}</span>`).join("")}
     ${h.gang?`<span class="bdg prox">Foyer de gang à ${h.gang.d.toFixed(1)} km</span>`:""}${h.zone?`<span class="bdg out">En zone ${ZLEV[h.zone.level].short.toLowerCase()}</span>`:""}</div></div>`).join("")
    :`<div class="empty">Aucun regroupement d'alertes ne dépasse le seuil sur cette période.<br>Essayez une période plus longue ou un rayon plus grand.</div>`;
  renderLegend();}
function hsPopup(h){return `<div class="pp"><h3>Foyer de violence ${h.id}</h3><div class="m">${esc(h.place)} · ${esc(h.dept||"?")} · rayon ≈ ${h.r.toFixed(1)} km</div>
  <dl><dt>Activité</dt><dd>${h.n} alertes (dont ${h.crit} critique(s)) · score ${h.score}</dd>
  <dt>Tendance</dt><dd>${h.w1} alerte(s) ces 7 derniers jours, ${h.w0} les 7 jours précédents</dd>
  <dt>Catégories</dt><dd>${h.cats.map(([k,n])=>`${(CATS[k]||CATS.autre).short} (${n})`).join(", ")}</dd>
  ${h.gang?`<dt>Foyer de gang connu à proximité</dt><dd>${esc(h.gang.f.zone)} — ${h.gang.d.toFixed(1)} km</dd>`:""}
  ${h.zone?`<dt>Zone d'insécurité</dt><dd>${esc(h.zone.name)} (${ZLEV[h.zone.level].short})</dd>`:`<dt>Zone d'insécurité</dt><dd>Aucune zone délimitée ici — <a href="#" onclick="event.preventDefault();showTab('zones');$('bDraw').click();">en délimiter une</a></dd>`}</dl></div>`;}
window.focusHS=id=>{const h=HOTS.find(x=>x.id===id);if(!h)return;if(!map.hasLayer(hotLayer))hotLayer.addTo(map);map.flyTo([h.lat,h.lon],13,{duration:.8});
  setTimeout(()=>hotLayer.eachLayer(l=>{if(l.options.title==="Foyer de violence "+id)l.openPopup();}),900);};
window.zoomDept=d=>{const f=DEPTS_GEO.features.find(x=>x.properties.name===d);if(f)map.flyToBounds(L.geoJSON(f).getBounds(),{duration:.8});};
window.showTab=showTab;
["aPer","aEps","aMin"].forEach(id=>$(id).onchange=()=>{renderAnalysis();renderDash();});

/* ===================== Paramètres & identité visuelle (onglet ⚙) ===================== */
function shade(hex,p){const n=parseInt(hex.slice(1),16);let r=n>>16,g=n>>8&255,b=n&255;const f=v=>Math.max(0,Math.min(255,Math.round(v+(p>0?(255-v)*p:v*p))));return "#"+[f(r),f(g),f(b)].map(x=>x.toString(16).padStart(2,"0")).join("");}
function setLogo(box,src){if(!box)return;box.querySelectorAll("img").forEach(i=>i.remove());box.classList.remove("hasimg");if(!src)return;
  const im=new Image();im.alt="Logo";im.onload=()=>{box.prepend(im);box.classList.add("hasimg");};im.onerror=()=>{};im.src=src;}
function applyBrand(){const c=CFG;document.title=c.titreSite||`${c.sigle} – Cartographie géospatiale de l'insécurité`;$("uSigle").textContent=c.sigle;$("cTitleT").textContent=`${c.sigle} · CENTRE DE COMMANDEMENT`;
  $("uSub").textContent=`${c.sigle} – ${c.nom} · ${c.institution}`;
  const src=c.logoData||c.logo;setLogo($("uLogoBox"),src);setLogo($("cLogo"),src);
  document.querySelectorAll(".c-class").forEach(e=>e.textContent=c.classification);
  $("cSubT").textContent=`OPÉRATIONNEL · ${c.sigle} · ${String(c.institution).toUpperCase()}`;
  const R_=document.documentElement.style;R_.setProperty("--navy",c.couleurPrincipale);R_.setProperty("--navy2",shade(c.couleurPrincipale,.18));R_.setProperty("--gold",c.couleurAccent);
  const pv=$("sLogoPrev");pv.innerHTML="Aucun logo";const im=new Image();im.onload=()=>{pv.innerHTML="";pv.appendChild(im);};im.src=src||"";}
function fillParams(){$("sSigle").value=CFG.sigle;$("sNom").value=CFG.nom;$("sInst").value=CFG.institution;$("sClass").value=CFG.classification;
  $("sCol1").value=CFG.couleurPrincipale;$("sCol2").value=CFG.couleurAccent;$("sProx").value=CFG.proximiteKm;$("sVer").textContent=UNITE.version;}
function saveCfg(){const diff={};for(const k in CFG)if(k==="logoData"||CFG[k]!==UNITE[k])diff[k]=CFG[k];try{localStorage.setItem(CFG_KEY,JSON.stringify(diff));}catch(e){toast("⚠ Impossible d'enregistrer les paramètres dans ce navigateur");}}
$("sSave").onclick=()=>{CFG.sigle=$("sSigle").value.trim()||UNITE.sigle;CFG.nom=$("sNom").value.trim()||UNITE.nom;CFG.institution=$("sInst").value.trim()||UNITE.institution;
  CFG.classification=$("sClass").value.trim()||UNITE.classification;CFG.couleurPrincipale=$("sCol1").value;CFG.couleurAccent=$("sCol2").value;
  CFG.proximiteKm=parseFloat($("sProx").value)||UNITE.proximiteKm;PROX_KM=CFG.proximiteKm;saveCfg();applyBrand();renderAll();toast("Paramètres enregistrés");};
$("sReset").onclick=()=>{askConfirm("Revenir aux paramètres d'origine (nom, logo importé, couleurs) ?").then(ok=>{if(!ok)return;CFG=Object.assign({},UNITE);PROX_KM=CFG.proximiteKm;try{localStorage.removeItem(CFG_KEY);}catch(e){}fillParams();applyBrand();renderAll();toast("Paramètres d'origine rétablis");});};
$("sLogoBtn").onclick=()=>$("sLogoFile").click();
$("sLogoDel").onclick=()=>{delete CFG.logoData;CFG.logo="";saveCfg();applyBrand();toast("Logo retiré");};
$("sLogoFile").onchange=e=>{const f=e.target.files[0];e.target.value="";if(!f)return;const rd=new FileReader();
  rd.onload=()=>{const im=new Image();im.onload=()=>{const m=256,s=Math.min(1,m/Math.max(im.width||m,im.height||m));const cv=document.createElement("canvas");cv.width=Math.round((im.width||m)*s);cv.height=Math.round((im.height||m)*s);
    cv.getContext("2d").drawImage(im,0,0,cv.width,cv.height);CFG.logoData=cv.toDataURL("image/png");saveCfg();applyBrand();toast("Logo enregistré");};im.onerror=()=>toast("Image illisible");im.src=rd.result;};rd.readAsDataURL(f);};
fillParams();applyBrand();


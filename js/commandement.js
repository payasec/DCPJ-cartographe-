/* =====================================================================
   CARTOGRAPHIE DCPJ – MODE COMMANDEMENT (écran tactique plein écran)
   Heure Zulu, coordonnées MGRS, niveau de menace, symbologie inspirée
   de l'APP-6 (OTAN), présentation automatique, SITREP.
   Seuils du niveau de menace : fonction threat() ci-dessous.
   ===================================================================== */
"use strict";
/* ===================== MODE COMMANDEMENT ===================== */
function toMGRS(lat,lon,prec){prec=prec||4;
  const a=6378137,f=1/298.257223563,k0=0.9996,e2=f*(2-f),ep2=e2/(1-e2),r=Math.PI/180;
  const zone=Math.floor((lon+180)/6)+1,lon0=((zone-1)*6-180+3)*r,phi=lat*r,lam=lon*r;
  const N=a/Math.sqrt(1-e2*Math.sin(phi)**2),T=Math.tan(phi)**2,C=ep2*Math.cos(phi)**2,A=Math.cos(phi)*(lam-lon0);
  const M=a*((1-e2/4-3*e2*e2/64-5*e2**3/256)*phi-(3*e2/8+3*e2*e2/32+45*e2**3/1024)*Math.sin(2*phi)+(15*e2*e2/256+45*e2**3/1024)*Math.sin(4*phi)-(35*e2**3/3072)*Math.sin(6*phi));
  const E=k0*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep2)*A**5/120)+500000;
  let Nn=k0*(M+N*Math.tan(phi)*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep2)*A**6/720));if(lat<0)Nn+=1e7;
  const band="CDEFGHJKLMNPQRSTUVWX"[Math.min(19,Math.floor((lat+80)/8))];
  const sets=["ABCDEFGH","JKLMNPQR","STUVWXYZ"],rows="ABCDEFGHJKLMNPQRSTUV";
  const col=sets[(zone-1)%3][Math.floor(E/1e5)-1],row=rows[(Math.floor(Nn/1e5)+(zone%2===0?5:0))%20];
  const d=10**(5-prec);return `${zone}${band} ${col}${row} ${String(Math.floor((E%1e5)/d)).padStart(prec,"0")} ${String(Math.floor((Nn%1e5)/d)).padStart(prec,"0")}`;}
function dms(v,pos,neg){const s=v<0?neg:pos;v=Math.abs(v);const d=Math.floor(v),m=Math.floor((v-d)*60),x=((v-d-m/60)*3600).toFixed(0);return `${d}°${String(m).padStart(2,"0")}'${String(x).padStart(2,"0")}"${s}`;}
const MON=["JAN","FEV","MAR","AVR","MAI","JUN","JUL","AOU","SEP","OCT","NOV","DEC"];
function dtg(d){d=new Date(d);const p=n=>String(n).padStart(2,"0");return `${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z ${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;}
function htTime(d){return new Date(d).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"America/Port-au-Prince"});}
const TL=[{n:1,l:"FAIBLE",c:"#3dff8a"},{n:2,l:"MODÉRÉ",c:"#7fd4ff"},{n:3,l:"ÉLEVÉ",c:"#ffd23f"},{n:4,l:"SÉVÈRE",c:"#ff8a1f"},{n:5,l:"CRITIQUE",c:"#ff3b3b"}];
function threat(){const now=Date.now();const A=DB.alerts.filter(a=>a.stat!=="fausse");
  const w7=A.filter(a=>now-new Date(a.date)<=7*864e5).reduce((s,a)=>s+(GW[a.grav]||2),0);
  const c24=A.filter(a=>a.grav==="critique"&&now-new Date(a.date)<=864e5).length;
  const s=w7+3*c24+5*detectHotspots(30,2,3).length+3*DB.zones.filter(z=>z.level==="rouge").length;
  return {score:s,lvl:TL[s<10?0:s<25?1:s<50?2:s<90?3:4]};}
// Symbologie tactique inspirée de l'APP-6 (OTAN) : losange = hostile, trèfle = inconnu/à vérifier, carré = traité
function symSVG(kind,col,txt,size){size=size||30;const s=size,h=s/2;let frame;
  if(kind==="hostile")frame=`<path d="M${h} 2 L${s-2} ${h} L${h} ${s-2} L2 ${h} Z" fill="${col}33" stroke="${col}" stroke-width="2.4"/>`;
  else if(kind==="unknown")frame=`<g fill="${col}2b" stroke="${col}" stroke-width="2.2"><circle cx="${h}" cy="${s*.3}" r="${s*.2}"/><circle cx="${h}" cy="${s*.7}" r="${s*.2}"/><circle cx="${s*.3}" cy="${h}" r="${s*.2}"/><circle cx="${s*.7}" cy="${h}" r="${s*.2}"/></g><rect x="${s*.3}" y="${s*.3}" width="${s*.4}" height="${s*.4}" fill="#0a1520"/>`;
  else frame=`<rect x="4" y="4" width="${s-8}" height="${s-8}" fill="${col}2b" stroke="${col}" stroke-width="2.2"/>`;
  return `<svg class="sym" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${frame}<text x="${h}" y="${h+4}" text-anchor="middle" font-family="Consolas,monospace" font-weight="800" font-size="${s*.36}" fill="#fff">${txt}</text></svg>`;}
const CODE=CODE_TACTIQUE;
function symFor(a){if(a.stat==="traitee")return ["neutral","#3dff8a"];if(a.stat==="confirmee")return ["hostile","#ff4545"];return ["unknown","#ffd23f"];}

let CM=null,cTourT=null,cRingsOn=false,cRings=null,cSat=false,cLastIds=new Set(),cTimer=null;
function openCmd(){$("cmd").classList.add("on");document.body.style.overflow="hidden";
  if(!CM){CM={};CM.map=L.map("cmap",{zoomControl:true,minZoom:7,maxZoom:18,maxBounds:HT_BOUNDS.pad(.6),attributionControl:true,zoomSnap:.25});
    CM.dark=NOBASE?L.layerGroup():L.layerGroup([L.tileLayer(ESRI+"Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",{maxZoom:16,attribution:"Fond © Esri"}),L.tileLayer(ESRI+"Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",{maxZoom:16})]).addTo(CM.map);
    CM.sat=NOBASE?L.layerGroup():L.layerGroup([L.tileLayer(ESRI+"World_Imagery/MapServer/tile/{z}/{y}/{x}",{maxZoom:19,attribution:"Imagerie © Esri, Maxar"}),L.tileLayer(ESRI+"Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",{maxZoom:19})]);
    CM.map.fitBounds(HT_BOUNDS);L.control.scale({imperial:false}).addTo(CM.map);
    CM.grid=L.layerGroup().addTo(CM.map);
    for(let la=18;la<=20.5;la+=.5)L.polyline([[la,-75],[la,-71]],{color:"#3ad1ff",weight:.6,opacity:.18,interactive:false}).addTo(CM.grid);
    for(let lo=-75;lo<=-71;lo+=.5)L.polyline([[17.5,lo],[20.5,lo]],{color:"#3ad1ff",weight:.6,opacity:.18,interactive:false}).addTo(CM.grid);
    L.polyline([[17.5,-72],[20.5,-72]],{color:"#ffb000",weight:1,opacity:.35,dashArray:"6 6",interactive:false}).bindTooltip("LIMITE ZONES UTM 18Q / 19Q",{sticky:true,className:"ring-lbl"}).addTo(CM.grid);
    CM.dep=L.geoJSON(DEPTS_GEO,{style:NOBASE?{color:"#3ad1ff",weight:1.1,opacity:.6,fillColor:"#0b1a27",fillOpacity:1,dashArray:"5 4"}:{color:"#3ad1ff",weight:1.1,opacity:.55,fillOpacity:0,dashArray:"5 4"},interactive:false}).addTo(CM.map);
    if(NOBASE){$("cmap").classList.add("nobase");$("cBase").style.display="none";}
    CM.idx=L.geoJSON(DEPTS_GEO,{style:()=>({stroke:false,fillOpacity:0}),interactive:false}).addTo(CM.map);
    CM.zones=L.layerGroup().addTo(CM.map);CM.hs=L.layerGroup().addTo(CM.map);CM.gangs=L.layerGroup().addTo(CM.map);CM.alerts=L.layerGroup().addTo(CM.map);
    CM.map.on("mousemove",e=>{const{lat,lng}=e.latlng;$("cRead").innerHTML=`<b>MGRS</b> ${toMGRS(lat,lng,5)}<br><b>GÉO</b> ${dms(lat,"N","S")} ${dms(lng,"E","W")}<br><b>DÉP.</b> ${esc(deptOf(lat,lng)||"—")} · <b>Z</b> ${CM.map.getZoom().toFixed(1)}`;});
    CM.map.on("click",e=>{if(!cRingsOn)return;if(cRings)CM.map.removeLayer(cRings);cRings=L.layerGroup().addTo(CM.map);
      [1,3,5,10].forEach(k=>{L.circle(e.latlng,{radius:k*1000,color:"#3ad1ff",weight:1.2,opacity:.85,fill:false,dashArray:k===10?"8 6":null,interactive:false}).addTo(cRings);
        L.tooltip({permanent:true,direction:"center",className:"ring-lbl"}).setLatLng([e.latlng.lat+k/111,e.latlng.lng]).setContent(k+" KM").addTo(cRings);});
      L.marker(e.latlng,{icon:L.divIcon({className:"",html:'<div style="width:14px;height:14px;border:2px solid #3ad1ff;border-radius:50%;box-shadow:0 0 8px #3ad1ff"></div>',iconSize:[14,14],iconAnchor:[7,7]})}).bindTooltip("PC · "+toMGRS(e.latlng.lat,e.latlng.lng,5),{permanent:true,direction:"bottom",offset:[0,8],className:"ring-lbl"}).addTo(cRings);});
    $("cLeg").innerHTML=`${symSVG("hostile","#ff4545","GA",22)} Groupe armé / menace confirmée<br>${symSVG("unknown","#ffd23f","AF",22)} Alerte à vérifier<br>${symSVG("neutral","#3dff8a","KD",22)} Alerte traitée<br><span style="display:inline-block;width:22px;height:22px;border:2px solid #ff4545;border-radius:50%;vertical-align:middle"></span> Foyer de violence détecté<br>`+
      Object.entries(CODE).map(([k,c])=>`<b style="color:#fff">${c}</b> ${CATS[k].short}`).join(" · ")+`<br><span style="color:#6f93a8">Symbologie inspirée de l'APP-6 (OTAN)</span>`;
  }
  setTimeout(()=>{CM.map.invalidateSize();CM.map.fitBounds(HT_BOUNDS);radarStart();},60);
  cLastIds=new Set(DB.alerts.map(a=>a.id));renderCmd();tickCmd();clearInterval(cTimer);cTimer=setInterval(()=>{tickCmd();},1000);}
function closeCmd(){radarStop();$("cmd").classList.remove("on");document.body.style.overflow="";stopTour();clearInterval(cTimer);if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});setTimeout(()=>map.invalidateSize(),60);}
let cTick=0;
function tickCmd(){const n=new Date();$("cZulu").textContent=dtg(n);$("cLocal").textContent=htTime(n);if(++cTick%30===0)renderCmd();}
function renderCmd(){if(!CM||!$("cmd").classList.contains("on"))return;try{radarData();}catch(e){}const now=Date.now();
  const A=DB.alerts.filter(a=>a.stat!=="fausse");
  const T=threat();$("cThreatL").textContent=T.lvl.n+" · "+T.lvl.l;$("cThreatL").style.color=T.lvl.c;
  [...$("cThreatS").children].forEach((i,k)=>{i.style.background=k<T.lvl.n?TL[k].c:"#13212e";i.style.boxShadow=k<T.lvl.n?`0 0 6px ${TL[k].c}`:"none";});
  const hs=detectHotspots(30,2,3);
  $("ck24").textContent=A.filter(a=>now-new Date(a.date)<=864e5).length;$("ck7").textContent=A.filter(a=>now-new Date(a.date)<=7*864e5).length;
  $("ckCrit").textContent=A.filter(a=>a.grav==="critique"&&!["traitee"].includes(a.stat)).length;$("ckHS").textContent=hs.length;$("ckGA").textContent=DB.foyers.length;$("ckZR").textContent=DB.zones.filter(z=>z.level==="rouge").length;
  // indice départemental (fond)
  const ix=deptIndex(30);CM.idx.setStyle(f=>{const v=(ix[f.properties.name]||{}).idx||0;return {stroke:false,fillColor:v>80?"#ff3b3b":v>60?"#ff6a2b":v>40?"#ff9d1f":v>20?"#ffd23f":"#3ad1ff",fillOpacity:v?Math.min(.32,.06+v/400):0};});
  $("cDep").innerHTML=Object.entries(ix).sort((a,b)=>b[1].idx-a[1].idx).map(([d,v])=>{const c=v.idx>80?"#ff3b3b":v.idx>60?"#ff6a2b":v.idx>40?"#ff9d1f":v.idx>20?"#ffd23f":"#3dff8a";
    return `<div class="c-row" onclick="cZoomDept('${esc(d).replace(/'/g,"\\'")}')"><span class="n">${esc(d.toUpperCase())}</span><span class="bar"><i style="width:${v.idx}%;background:${c};box-shadow:0 0 6px ${c}"></i></span><span class="v">${v.idx}</span></div>`;}).join("");
  // zones
  CM.zones.clearLayers();DB.zones.forEach(z=>{const c=z.level==="rouge"?"#ff4545":z.level==="orange"?"#ff9d1f":"#ffd23f";
    L.polygon(z.coords,{color:c,weight:1.8,opacity:.95,fillColor:c,fillOpacity:.14,dashArray:z.level==="rouge"?null:"6 4"}).bindPopup(()=>zonePopup(z),{maxWidth:340}).addTo(CM.zones);
    L.tooltip({permanent:true,direction:"center",className:"sym-lbl"}).setLatLng(polyCentroid(z.coords)).setContent(esc(z.name.replace(/^\[DÉMO\]\s*/,"").toUpperCase())).addTo(CM.zones);});
  $("cZR").innerHTML=DB.zones.filter(z=>z.level==="rouge").map(z=>`<div class="it" onclick="cFly(${polyCentroid(z.coords).join(",")},12)"><b>${esc(z.name)}</b><small>${esc(z.dept||"")} · ${polyAreaKm2(z.coords).toFixed(1)} KM² · ${toMGRS(...polyCentroid(z.coords),4)}</small></div>`).join("")||`<div style="font:11px Consolas,monospace;color:#6f93a8">AUCUNE ZONE ROUGE DÉLIMITÉE</div>`;
  // foyers de violence
  CM.hs.clearLayers();hs.forEach(h=>{L.circle([h.lat,h.lon],{radius:h.r*1000,color:"#ff4545",weight:1,opacity:.6,fillColor:"#ff4545",fillOpacity:.07,interactive:false}).addTo(CM.hs);
    L.marker([h.lat,h.lon],{icon:L.divIcon({className:"",html:`<div class="hsr"><span>${h.id}</span></div>`,iconSize:[44,44],iconAnchor:[22,22]}),zIndexOffset:-50}).bindPopup(()=>hsPopup(h),{maxWidth:340}).addTo(CM.hs);});
  $("cHS").innerHTML=hs.map(h=>`<div class="it" onclick="cFly(${h.lat},${h.lon},13)"><b style="color:#ff6b6b">${h.id}</b> <b>${esc((h.place||"").toUpperCase())}</b> ${h.trend>0?'<span style="color:#ff4545">▲</span>':h.trend<0?'<span style="color:#3dff8a">▼</span>':'<span style="color:#7fa7bf">■</span>'}
    <small>${h.n} ALERTES · SCORE ${h.score} · ${toMGRS(h.lat,h.lon,4)}</small></div>`).join("")||`<div style="font:11px Consolas,monospace;color:#6f93a8">AUCUN FOYER AU-DESSUS DU SEUIL</div>`;
  // groupes armés
  CM.gangs.clearLayers();DB.foyers.forEach(f=>{L.circle([f.lat,f.lon],{radius:(f.rad||1.2)*1000,color:"#ff4545",weight:.8,opacity:.5,fill:false,dashArray:"3 4",interactive:false}).addTo(CM.gangs);
    L.marker([f.lat,f.lon],{icon:L.divIcon({className:"",html:symSVG("hostile","#ff4545","GA",30),iconSize:[30,30],iconAnchor:[15,15]})}).bindPopup(()=>foyerPopup(f)+`<div class="m" style="margin-top:6px">MGRS ${toMGRS(f.lat,f.lon,5)}</div>`,{maxWidth:340})
      .bindTooltip(esc((f.zone||"").split("/")[0].trim().toUpperCase()),{permanent:CM.map.getZoom()>=11,direction:"right",offset:[14,0],className:"sym-lbl"}).addTo(CM.gangs);});
  // alertes
  CM.alerts.clearLayers();A.forEach(a=>{const [k,c]=symFor(a);
    L.marker([a.lat,a.lon],{icon:L.divIcon({className:"",html:symSVG(k,c,CODE[a.cat]||"??",26),iconSize:[26,26],iconAnchor:[13,13]}),zIndexOffset:a.grav==="critique"?400:0})
      .bindPopup(()=>alertPopup(a).replace('<div class="m">',`<div class="m">MGRS ${toMGRS(a.lat,a.lon,5)} · `),{maxWidth:340}).addTo(CM.alerts);});
  // fil
  const feed=A.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,40);
  $("cFeed").innerHTML=feed.map(a=>{const c=CATS[a.cat]||CATS.autre,g=GRAV[a.grav]||GRAV.moyenne;const isNew=!cLastIds.has(a.id);
    return `<div class="c-fi${isNew?" new":""}" style="border-left-color:${g.color}" onclick="cFly(${a.lat},${a.lon},14)"><div class="d">${dtg(a.date)} · ${esc(a.id)}</div>
      <div class="t"><b style="color:${c.color==="#4a148c"?"#c18bff":c.color}">[${CODE[a.cat]}]</b> ${esc(a.title.replace(/^\[DÉMO\]\s*/,""))}</div>
      <div class="g">${g.label.toUpperCase()} · ${esc((a.place||"").toUpperCase())} · ${toMGRS(a.lat,a.lon,4)}</div></div>`;}).join("")||`<div style="color:#6f93a8">AUCUNE ALERTE</div>`;
  cLastIds=new Set(DB.alerts.map(a=>a.id));
  // bandeau
  const flash=A.filter(a=>["critique","elevee"].includes(a.grav)).sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,12);
  $("cTick").textContent=(flash.length?flash.map(a=>`${dtg(a.date)} ▸ ${(CATS[a.cat]||CATS.autre).short.toUpperCase()} · ${(a.place||"").toUpperCase()} · ${a.title.replace(/^\[DÉMO\]\s*/,"").toUpperCase()}`).join("     ◆     "):"AUCUNE ALERTE ÉLEVÉE OU CRITIQUE EN COURS")+"     ◆     NIVEAU DE MENACE NATIONAL : "+T.lvl.n+" – "+T.lvl.l;}
window.cFly=(la,lo,z)=>{CM.map.flyTo([la,lo],z||13,{duration:1.2});};
window.cZoomDept=d=>{const f=DEPTS_GEO.features.find(x=>x.properties.name===d);if(f)CM.map.flyToBounds(L.geoJSON(f).getBounds(),{duration:1.2});};
// Présentation automatique
function tourTargets(){const t=[{k:"VUE NATIONALE",b:HT_BOUNDS}];
  detectHotspots(30,2,3).slice(0,6).forEach(h=>t.push({k:`${h.id} · FOYER DE VIOLENCE · ${(h.place||"").toUpperCase()} · ${h.n} ALERTES`,ll:[h.lat,h.lon],z:13}));
  DB.zones.filter(z=>z.level==="rouge").forEach(z=>t.push({k:`ZONE ROUGE · ${z.name.replace(/^\[DÉMO\]\s*/,"").toUpperCase()}`,b:L.latLngBounds(z.coords).pad(.4)}));
  const fn=[...new Set(DB.foyers.map(f=>f.dept))];fn.forEach(d=>{const F=DB.foyers.filter(f=>f.dept===d);t.push({k:`GROUPES ARMÉS · ${d.toUpperCase()} · ${F.length} FOYERS SIGNALÉS`,b:L.latLngBounds(F.map(f=>[f.lat,f.lon])).pad(.35)});});
  DB.alerts.filter(a=>a.grav==="critique"&&!["traitee","fausse"].includes(a.stat)).slice(-4).forEach(a=>t.push({k:`ALERTE CRITIQUE · ${(CATS[a.cat]||CATS.autre).short.toUpperCase()} · ${(a.place||"").toUpperCase()}`,ll:[a.lat,a.lon],z:14}));
  return t;}
function startTour(){const T=tourTargets();let i=0;$("cTour").classList.add("on");$("cTour").textContent="■ ARRÊTER";
  const step=()=>{const s=T[i%T.length];$("cCap").style.display="block";$("cCap").textContent=`OBJECTIF ${i%T.length+1}/${T.length} · ${s.k}`;
    if(s.b)CM.map.flyToBounds(s.b,{duration:2.2});else CM.map.flyTo(s.ll,s.z,{duration:2.2});i++;};
  step();cTourT=setInterval(step,9000);}
function stopTour(){clearInterval(cTourT);cTourT=null;$("cCap").style.display="none";$("cTour").classList.remove("on");$("cTour").textContent="▶ PRÉSENTATION";}
// SITREP
function buildSitrep(){const now=new Date(),T=threat(),A=DB.alerts.filter(a=>a.stat!=="fausse");const d24=A.filter(a=>now-new Date(a.date)<=864e5),d7=A.filter(a=>now-new Date(a.date)<=7*864e5);
  const hs=detectHotspots(30,2,3),ix=deptIndex(30),L_="─".repeat(78);const pad=(s,n)=>String(s).padEnd(n).slice(0,n);
  let s=`${CFG.classification.replace(/ · /g,' – ')}\n${L_}\nDE        : ${CFG.sigle} – ${CFG.nom.toUpperCase()}\n            CENTRE DE COMMANDEMENT OPÉRATIONNEL\nÀ         : ____________________________________________\nGDH       : ${dtg(now)}  (heure locale Haïti : ${now.toLocaleString("fr-FR",{timeZone:"America/Port-au-Prince",dateStyle:"long",timeStyle:"short"})})\nOBJET     : RAPPORT DE SITUATION (SITREP) – SITUATION SÉCURITAIRE NATIONALE\nPÉRIODE   : 24 H / 7 JOURS (foyers de violence : 30 jours)\n${L_}\n\n`;
  s+=`1. SITUATION GÉNÉRALE\n   Niveau de menace national : ${T.lvl.n} – ${T.lvl.l}\n   Alertes 24 h : ${d24.length}   |   Alertes 7 j : ${d7.length}   |   Critiques actives : ${A.filter(a=>a.grav==="critique"&&a.stat!=="traitee").length}\n`;
  const cc={};d7.forEach(a=>cc[a.cat]=(cc[a.cat]||0)+1);s+=`   Répartition 7 j : ${Object.entries(cc).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${CATS[k].short} ${n}`).join(" · ")||"néant"}\n\n`;
  s+=`2. GROUPES ARMÉS SIGNALÉS (${DB.foyers.length})\n`;DB.foyers.slice(0,15).forEach((f,i)=>{s+=`   ${String(i+1).padStart(2)}. ${pad(f.zone,44)} ${pad(f.dept||"",11)} MGRS ${toMGRS(f.lat,f.lon,4)}\n       Chef : ${(f.chef||"—").split(" — ")[0]}\n`;});if(DB.foyers.length>15)s+=`   … et ${DB.foyers.length-15} autre(s)\n`;s+="\n";
  s+=`3. FOYERS DE VIOLENCE DÉTECTÉS (${hs.length})\n`;s+=hs.length?hs.map(h=>`   ${pad(h.id,6)} ${pad(h.place,26)} ${pad(h.dept,11)} ${String(h.n).padStart(3)} alertes  score ${String(h.score).padStart(3)}  ${h.trend>0?"EN HAUSSE":h.trend<0?"en baisse":"stable"}\n          MGRS ${toMGRS(h.lat,h.lon,4)}${h.gang?`  – groupe armé à ${h.gang.d.toFixed(1)} km (${h.gang.f.zone})`:""}`).join("\n")+"\n\n":"   Néant.\n\n";
  s+=`4. ZONES D'INSÉCURITÉ\n`;["rouge","orange","jaune"].forEach(l=>{const Z=DB.zones.filter(z=>z.level===l);s+=`   ${ZLEV[l].short.toUpperCase()} (${Z.length}) : ${Z.map(z=>z.name.replace(/^\[DÉMO\]\s*/,"")+" ["+(z.dept||"")+"]").join(" ; ")||"néant"}\n`;});s+="\n";
  s+=`5. ÉVÉNEMENTS MARQUANTS (24 H)\n`;const ev=d24.filter(a=>["critique","elevee"].includes(a.grav)).sort((a,b)=>new Date(b.date)-new Date(a.date));
  s+=ev.length?ev.slice(0,15).map(a=>`   ${dtg(a.date)}  ${pad((CATS[a.cat]||CATS.autre).short.toUpperCase(),10)} ${pad(GRAV[a.grav].label.toUpperCase(),8)} ${pad(a.place||"",18)} ${toMGRS(a.lat,a.lon,4)}\n       ${a.title.replace(/^\[DÉMO\]\s*/,"")} (${STAT[a.stat].label})`).join("\n")+"\n\n":"   Aucun événement de gravité élevée ou critique.\n\n";
  s+=`6. ÉVALUATION PAR DÉPARTEMENT (indice relatif 0–100, 30 jours)\n`;Object.entries(ix).sort((a,b)=>b[1].idx-a[1].idx).forEach(([d,v])=>{s+=`   ${pad(d,14)} ${String(v.idx).padStart(3)}  ${"█".repeat(Math.round(v.idx/5)).padEnd(20,"·")}  ${idxCls(v.idx).label}\n`;});
  s+=`\n7. MESURES PRISES / RECOMMANDATIONS\n   ________________________________________________________________________\n   ________________________________________________________________________\n\n8. OFFICIER DE PERMANENCE\n   Nom / grade : ____________________________   Signature : ______________\n${L_}\nGénéré par la Cartographie ${CFG.sigle} le ${now.toLocaleString("fr-FR")} – données à vérifier avant diffusion.\n`;
  if(DB.alerts.some(a=>a.demo)||DB.zones.some(z=>z.demo))s="⚠ ATTENTION : CE RAPPORT CONTIENT DES DONNÉES DE DÉMONSTRATION FICTIVES\n\n"+s;
  return s;}
$("bCmd").onclick=openCmd;$("cExit").onclick=closeCmd;
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&$("cmd").classList.contains("on")){if($("cModal").classList.contains("on"))$("cModal").classList.remove("on");else if(!document.fullscreenElement)closeCmd();}});
$("cTour").onclick=()=>cTourT?stopTour():startTour();
$("cRings").onclick=()=>{cRingsOn=!cRingsOn;$("cRings").classList.toggle("on",cRingsOn);$("cmap").style.cursor=cRingsOn?"crosshair":"";if(!cRingsOn&&cRings){CM.map.removeLayer(cRings);cRings=null;}};
$("cBase").onclick=()=>{cSat=!cSat;if(cSat){CM.map.removeLayer(CM.dark);CM.sat.addTo(CM.map);$("cmap").style.setProperty("--tilefx","brightness(.62) saturate(.7) contrast(1.1)");}else{CM.map.removeLayer(CM.sat);CM.dark.addTo(CM.map);$("cmap").style.removeProperty("--tilefx");}$("cBase").classList.toggle("on",cSat);};
$("cFull").onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else $("cmd").requestFullscreen?.().catch(()=>toast("Plein écran refusé par le navigateur"));};
$("cSit").onclick=()=>{$("sText").textContent=buildSitrep();$("cModal").classList.add("on");};
$("sClose").onclick=()=>$("cModal").classList.remove("on");
$("sCopy").onclick=()=>{navigator.clipboard?.writeText($("sText").textContent).then(()=>toast("SITREP copié"),()=>toast("Copie impossible : sélectionnez le texte"));};
$("sDl").onclick=()=>download(`SITREP_${CFG.sigle}_${dtg(new Date()).replace(/\s/g,"_")}.txt`,"﻿"+$("sText").textContent,"text/plain;charset=utf-8");
$("sPrint").onclick=()=>{if(HOSTED){toast("Impression indisponible dans ce lien : téléchargez ou copiez le SITREP.");return;}$("sitrepPrint").textContent=$("sText").textContent;document.body.classList.add("cmdprint");window.print();setTimeout(()=>document.body.classList.remove("cmdprint"),500);};


/* ===================== RADAR (balayage décoratif + cibles réelles) =====================
   Le radar montre la carte d'Haïti vue « d'en haut » : chaque point est une alerte ou un
   groupe armé réel, placé selon sa position. Le faisceau fait un tour en RADAR_TOUR ms ;
   chaque cible s'illumine quand il passe dessus, puis s'éteint lentement.            */
const RADAR_TOUR = 4000;                       // durée d'un tour de balayage (ms)
const RADAR_CENTRE = [19.05, -72.75];          // centre du radar (centre d'Haïti)
const RADAR_PORTEE_KM = 190;                   // rayon couvert par le radar
let RAD={raf:0,t0:0,blips:[],outline:[],last:0};
function radarProj(lat,lon){const kx=111.32*Math.cos(RADAR_CENTRE[0]*Math.PI/180),ky=110.57;
  return [(lon-RADAR_CENTRE[1])*kx/RADAR_PORTEE_KM,-(lat-RADAR_CENTRE[0])*ky/RADAR_PORTEE_KM];}   // -1..1
function radarData(){
  RAD.outline=[];DEPTS_GEO.features.forEach(f=>{const g=f.geometry;(g.type==="Polygon"?[g.coordinates]:g.coordinates).forEach(p=>RAD.outline.push(p[0].map(c=>radarProj(c[1],c[0]))));});
  const old=new Map(RAD.blips.map(b=>[b.id,b.lit]));RAD.blips=[];
  DB.alerts.filter(a=>a.stat!=="fausse").forEach(a=>{const [k,c]=symFor(a);RAD.blips.push({id:a.id,p:radarProj(a.lat,a.lon),col:c,kind:k,crit:a.grav==="critique",lit:old.get(a.id)||0});});
  DB.foyers.forEach(f=>RAD.blips.push({id:f.id,p:radarProj(f.lat,f.lon),col:"#ff4545",kind:"hostile",crit:false,lit:old.get(f.id)||0}));
  RAD.blips.forEach(b=>{b.ang=(Math.atan2(b.p[1],b.p[0])+Math.PI*2.5)%(Math.PI*2);});   // 0 = nord, sens horaire
  $("rT").textContent=RAD.blips.length;$("rH").textContent=RAD.blips.filter(b=>b.kind==="hostile").length;$("rU").textContent=RAD.blips.filter(b=>b.kind==="unknown").length;}
function radarFrame(now){const cv=$("radar");if(!cv||!$("cmd").classList.contains("on")){RAD.raf=0;return;}
  const dpr=window.devicePixelRatio||1,W=cv.clientWidth,H=cv.clientHeight;if(!W){RAD.raf=requestAnimationFrame(radarFrame);return;}
  if(cv.width!==Math.round(W*dpr)||cv.height!==Math.round(H*dpr)){cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);}
  const x=cv.getContext("2d");x.setTransform(dpr,0,0,dpr,0,0);const cx=W/2,cy=H/2,R=Math.min(W,H)/2-4;
  if(now-RAD.last>15000){radarData();RAD.last=now;}
  // fond
  x.clearRect(0,0,W,H);const bg=x.createRadialGradient(cx,cy,0,cx,cy,R);bg.addColorStop(0,"#06281c");bg.addColorStop(1,"#020b08");
  x.fillStyle=bg;x.beginPath();x.arc(cx,cy,R,0,7);x.fill();
  // anneaux + graduations
  x.strokeStyle="rgba(61,255,138,.28)";x.lineWidth=1;for(let i=1;i<=4;i++){x.beginPath();x.arc(cx,cy,R*i/4,0,7);x.stroke();}
  x.beginPath();x.moveTo(cx-R,cy);x.lineTo(cx+R,cy);x.moveTo(cx,cy-R);x.lineTo(cx,cy+R);x.stroke();
  for(let d=0;d<360;d+=10){const a=d*Math.PI/180,l=d%30===0?8:4;x.beginPath();x.moveTo(cx+Math.sin(a)*R,cy-Math.cos(a)*R);x.lineTo(cx+Math.sin(a)*(R-l),cy-Math.cos(a)*(R-l));x.stroke();}
  x.fillStyle="rgba(61,255,138,.75)";x.font="bold 10px Consolas,monospace";x.textAlign="center";x.textBaseline="middle";
  [["N",0],["E",90],["S",180],["O",270]].forEach(([s,d])=>{const a=d*Math.PI/180;x.fillText(s,cx+Math.sin(a)*(R-16),cy-Math.cos(a)*(R-16));});
  x.font="8.5px Consolas,monospace";x.fillStyle="rgba(61,255,138,.45)";for(let i=1;i<=3;i++)x.fillText(Math.round(RADAR_PORTEE_KM*i/4)+"km",cx+4+R*i/4*0.7071,cy-R*i/4*0.7071-5);
  // contour d'Haïti
  x.save();x.beginPath();x.arc(cx,cy,R,0,7);x.clip();x.strokeStyle="rgba(61,255,138,.5)";x.lineWidth=1;x.fillStyle="rgba(61,255,138,.05)";
  RAD.outline.forEach(r=>{x.beginPath();r.forEach((p,i)=>{const X=cx+p[0]*R,Y=cy+p[1]*R;i?x.lineTo(X,Y):x.moveTo(X,Y);});x.closePath();x.fill();x.stroke();});
  // faisceau
  const ang=((now-RAD.t0)%RADAR_TOUR)/RADAR_TOUR*Math.PI*2;   // 0 = nord
  const st=ang-Math.PI/2;
  if(x.createConicGradient){const g=x.createConicGradient(st-1.1,cx,cy);g.addColorStop(0,"rgba(61,255,138,0)");g.addColorStop(.97,"rgba(61,255,138,.38)");g.addColorStop(1,"rgba(61,255,138,0)");
    x.fillStyle=g;x.beginPath();x.moveTo(cx,cy);x.arc(cx,cy,R,st-1.1,st);x.closePath();x.fill();}
  else{for(let i=0;i<24;i++){x.fillStyle=`rgba(61,255,138,${.016*i})`;x.beginPath();x.moveTo(cx,cy);x.arc(cx,cy,R,st-1.1+i*1.1/24,st-1.1+(i+1)*1.1/24);x.closePath();x.fill();}}
  x.strokeStyle="rgba(170,255,210,.95)";x.lineWidth=1.6;x.shadowColor="#3dff8a";x.shadowBlur=8;x.beginPath();x.moveTo(cx,cy);x.lineTo(cx+Math.cos(st)*R,cy+Math.sin(st)*R);x.stroke();x.shadowBlur=0;
  // cibles
  const prev=RAD.prevAng??ang;RAD.blips.forEach(b=>{const crossed=prev<=ang?(b.ang>prev&&b.ang<=ang):(b.ang>prev||b.ang<=ang);if(crossed)b.lit=now;
    const age=now-b.lit,al=b.lit?Math.max(0,1-age/(RADAR_TOUR*.9)):0,X=cx+b.p[0]*R,Y=cy+b.p[1]*R;if(Math.hypot(b.p[0],b.p[1])>1)return;
    x.globalAlpha=.18+al*.82;x.fillStyle=b.col;x.shadowColor=b.col;x.shadowBlur=10*al;
    if(b.kind==="hostile"){x.beginPath();x.moveTo(X,Y-4);x.lineTo(X+4,Y);x.lineTo(X,Y+4);x.lineTo(X-4,Y);x.closePath();x.fill();}else{x.beginPath();x.arc(X,Y,2.8,0,7);x.fill();}
    if(b.crit&&al>.2){x.strokeStyle=b.col;x.lineWidth=1;x.beginPath();x.arc(X,Y,4+(1-al)*12,0,7);x.stroke();}});
  x.globalAlpha=1;x.shadowBlur=0;RAD.prevAng=ang;x.restore();
  // bord
  x.strokeStyle="rgba(61,255,138,.7)";x.lineWidth=1.5;x.beginPath();x.arc(cx,cy,R,0,7);x.stroke();
  x.fillStyle="#3dff8a";x.beginPath();x.arc(cx,cy,2.5,0,7);x.fill();
  $("rAz").textContent="AZ "+String(Math.round(ang*180/Math.PI)%360).padStart(3,"0")+"°";
  RAD.raf=requestAnimationFrame(radarFrame);}
function radarStart(){radarData();RAD.last=performance.now();if(!RAD.t0)RAD.t0=performance.now();if(!RAD.raf)RAD.raf=requestAnimationFrame(radarFrame);}
function radarStop(){if(RAD.raf)cancelAnimationFrame(RAD.raf);RAD.raf=0;}
$("cSweepBtn").onclick=()=>{const on=$("cSweep").classList.toggle("off");$("cSweepBtn").classList.toggle("on",!on);};

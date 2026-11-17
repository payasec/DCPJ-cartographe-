"use strict";
/* ===================== Démarrage ===================== */
function tick(){const d=new Date();$("clock").innerHTML=d.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})+"<br>"+d.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});}
tick();setInterval(tick,30000);setInterval(()=>{renderList();},60000);
renderAll();updLabels();
if(!storageOK)toast("⚠ Ce navigateur bloque la sauvegarde automatique : pensez à « Sauvegarde complète ».");

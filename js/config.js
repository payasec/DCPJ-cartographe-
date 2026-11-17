/* =====================================================================
   CARTOGRAPHIE DCPJ – CONFIGURATION
   C'est le fichier à modifier en premier. Enregistrez puis rechargez
   la page (F5) pour voir le résultat.
   Règle d'or : gardez les guillemets "…", les virgules et les accolades.
   ===================================================================== */

/* ---------- 1. Identité de l'unité ----------
   (Peut aussi être changée sans code dans l'onglet ⚙ Paramètres.) */
const UNITE = {
  sigle: "DCPJ",
  nom: "Direction Centrale de la Police Judiciaire",
  institution: "Police Nationale d'Haïti",
  logo: "images/logo-dcpj.png",            // déposez le logo dans le dossier images
  classification: "CONFIDENTIEL · USAGE INTERNE DCPJ · NE PAS DIFFUSER",
  couleurPrincipale: "#0e2340",            // bleu marine
  couleurAccent: "#d4a017",                // or
  proximiteKm: 5,                          // alerte « proche d'un foyer » en dessous de cette distance
  titreSite: "VIGIE · Cartographie géospatiale de l'insécurité – PNH",   // titre affiché dans l'onglet du navigateur
  version: "1.2"
};

/* ---------- 2. Catégories d'alertes ----------
   clé: { label: nom complet, short: nom court, color: couleur, ch: lettre sur la carte }
   Pour ajouter une catégorie, copiez une ligne et changez la clé (sans espace ni accent).
   Ajoutez aussi son code à 2 lettres dans CODE_TACTIQUE plus bas. */
const CATS = {
  viol:   {label:"Viol / agression sexuelle", short:"Viol", color:"#ad1457", ch:"V"},
  drogue: {label:"Drogue / stupéfiants", short:"Drogue", color:"#2e7d32", ch:"D"},
  enlev:  {label:"Enlèvement", short:"Enlèvement", color:"#c62828", ch:"E"},
  armes:  {label:"Armes à feu", short:"Armes", color:"#e65100", ch:"A"},
  gang:   {label:"Activité de gang", short:"Gang", color:"#4a148c", ch:"G"},
  autre:  {label:"Autre", short:"Autre", color:"#546e7a", ch:"•"}
};

/* ---------- 3. Gravité ----------
   w = poids dans la carte de chaleur (0 à 1) */
const GRAV = {faible:{label:"Faible",color:"#78909c",w:.35}, moyenne:{label:"Moyenne",color:"#f9a825",w:.6}, elevee:{label:"Élevée",color:"#ef6c00",w:.85}, critique:{label:"Critique",color:"#c62828",w:1}};

/* ---------- 4. Statuts de traitement ---------- */
const STAT = {nouvelle:{label:"Nouvelle",color:"#1565c0"}, verif:{label:"En vérification",color:"#6a1b9a"}, confirmee:{label:"Confirmée",color:"#c62828"}, traitee:{label:"Traitée",color:"#2e7d32"}, fausse:{label:"Fausse alerte",color:"#9e9e9e"}};

/* ---------- 5. Sources possibles d'une alerte ---------- */
const SRCS = ["Réseaux sociaux (veille web)","Appel citoyen / 114","Patrouille","Informateur","Rapport d'unité","Médias","Autre"];

/* ---------- 6. Types d'activité des foyers de gangs ---------- */
const FCATS = {foncier:"Déchoukage / foncier", vol:"Vol à main armée", enlev:"Enlèvement / rançon", assassinat:"Assassinat", taxe:"Taxation illégale", drogue:"Stupéfiants", autre:"Autres"};

/* ---------- 7. Niveaux des zones d'insécurité ----------
   w = poids dans l'indice départemental */
const ZLEV = {rouge:{label:"Zone rouge – danger extrême / contrôle armé",short:"Rouge",color:"#d32f2f",w:6},orange:{label:"Zone orange – risque élevé",short:"Orange",color:"#f57c00",w:3},jaune:{label:"Zone jaune – vigilance",short:"Jaune",color:"#f9c22e",w:1}};

/* ---------- 8. Types de zones ---------- */
const ZTYPES = ["Contrôle par un gang armé","Axe routier dangereux (braquages, barrages)","Zone d'enlèvements","Trafic de drogue / d'armes","Déchoukage / conflit foncier","Violences sexuelles","Autre"];

/* ---------- 9. Poids des alertes dans l'indice et les foyers de violence ---------- */
const GW = {faible:1,moyenne:2,elevee:3,critique:5};

/* ---------- 10. Classes de l'indice d'insécurité (0–100) ---------- */
const IDX_CLS = [{min:81,label:"Critique",color:"#7f0000"},{min:61,label:"Très élevé",color:"#c62828"},{min:41,label:"Élevé",color:"#ef6c00"},{min:21,label:"Modéré",color:"#f9a825"},{min:1,label:"Faible",color:"#fdd98b"},{min:0,label:"Calme",color:"#e8f0e3"}];
const idxCls = v => IDX_CLS.find(c=>v>=c.min);


/* ---------- 11. Codes à 2 lettres du Mode Commandement ---------- */
const CODE_TACTIQUE = {viol:"VS", drogue:"DR", enlev:"KD", armes:"AF", gang:"GA", autre:"??"};

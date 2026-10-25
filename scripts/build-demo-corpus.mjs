/**
 * Génère un corpus de démonstration pour Nomad Pocket Library.
 *
 * Ce script simule, à petite échelle, le pipeline réel de préparation du corpus :
 *  1. Construction d'une base SQLite (`oeuvres`) avec sql.js (même moteur que le client).
 *  2. Export binaire de la base.
 *  3. Compression gzip (pako) — mise en situation du pipeline de compression/segmentation
 *     (en production : LZMA preset 9 extreme sur les 1 640 824 832 octets réels).
 *  4. Découpage en N segments binaires + calcul SHA-256 de chaque segment.
 *  5. Écriture d'un manifest.json (nom, version, tailles, liste ordonnée des chunks + hash).
 *  6. Écriture d'un catalog_index.json allégé (métadonnées seules, sans texte intégral)
 *     pour permettre une navigation du catalogue AVANT même l'import du corpus complet.
 *
 * Les textes utilisés sont des œuvres ou extraits du domaine public (Gutenberg / 1910 et antérieur).
 */
import initSqlJs from "sql.js";
import * as pako from "pako";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../public/demo-corpus");
mkdirSync(OUT_DIR, { recursive: true });

const oeuvres = [
  {
    id: "demo_lafontaine_corbeau",
    titre: "Le Corbeau et le Renard",
    auteur: "Jean de La Fontaine",
    dates_auteur: "1621-1695",
    type_genre: "Contes & Fables",
    categories_tags: ["Genre: Contes & Fables", "Forme: Fables & Apologues", "17th century", "France"],
    tome: "Fables, Livre I",
    sources_disponibles: ["gutenberg"],
    siecle: "XVIIe siècle",
    mouvement_litteraire: "Classicisme",
    texte_integral: `Maître Corbeau, sur un arbre perché,
Tenait en son bec un fromage.
Maître Renard, par l'odeur alléché,
Lui tint à peu près ce langage :
« Hé ! bonjour, Monsieur du Corbeau.
Que vous êtes joli ! que vous me semblez beau !
Sans mentir, si votre ramage
Se rapporte à votre plumage,
Vous êtes le Phénix des hôtes de ces bois. »
À ces mots le Corbeau ne se sent pas de joie ;
Et pour montrer sa belle voix,
Il ouvre un large bec, laisse tomber sa proie.

Le Renard s'en saisit, et dit : « Mon bon Monsieur,
Apprenez que tout flatteur
Vit aux dépens de celui qui l'écoute :
Cette leçon vaut bien un fromage, sans doute. »
Le Corbeau, honteux et confus,
Jura, mais un peu tard, qu'on ne l'y prendrait plus.

Chaque vers de cette fable est un petit théâtre où la vanité se laisse prendre au piège du compliment. La Fontaine ne moralise jamais lourdement : il observe, il sourit, il laisse le lecteur tirer la leçon de la chute du fromage.`,
  },
  {
    id: "demo_lafontaine_cigale",
    titre: "La Cigale et la Fourmi",
    auteur: "Jean de La Fontaine",
    dates_auteur: "1621-1695",
    type_genre: "Contes & Fables",
    categories_tags: ["Genre: Contes & Fables", "Forme: Fables & Apologues", "17th century", "France"],
    tome: "Fables, Livre I",
    sources_disponibles: ["gutenberg"],
    siecle: "XVIIe siècle",
    mouvement_litteraire: "Classicisme",
    texte_integral: `La Cigale, ayant chanté
Tout l'été,
Se trouva fort dépourvue
Quand la bise fut venue :
Pas un seul petit morceau
De mouche ou de vermisseau.
Elle alla crier famine
Chez la Fourmi sa voisine,
La priant de lui prêter
Quelque grain pour subsister
Jusqu'à la saison nouvelle.
« Je vous paierai, lui dit-elle,
Avant l'août, foi d'animal,
Intérêt et principal. »
La Fourmi n'est pas prêteuse ;
C'est là son moindre défaut.
« Que faisiez-vous au temps chaud ?
Dit-elle à cette emprunteuse.
— Nuit et jour à tout venant
Je chantais, ne vous déplaise.
— Vous chantiez ? j'en suis fort aise.
Eh bien ! dansez maintenant. »

Entre l'insouciance et la prévoyance, La Fontaine ne tranche pas tout à fait : il campe deux caractères, et laisse chacun y reconnaître une part de soi.`,
  },
  {
    id: "demo_hugo_demain",
    titre: "Demain, dès l'aube...",
    auteur: "Victor Hugo",
    dates_auteur: "1802-1885",
    type_genre: "Poésie",
    categories_tags: ["Genre: Poésie", "Forme: Poème", "19th century", "France"],
    tome: "Les Contemplations, Livre IV",
    sources_disponibles: ["gutenberg"],
    siecle: "XIXe siècle",
    mouvement_litteraire: "Romantisme",
    texte_integral: `Demain, dès l'aube, à l'heure où blanchit la campagne,
Je partirai. Vois-tu, je sais que tu m'attends.
J'irai par la forêt, j'irai par la montagne.
Je ne puis demeurer loin de toi plus longtemps.

Je marcherai les yeux fixés sur mes pensées,
Sans rien voir au dehors, sans entendre aucun bruit,
Seul, inconnu, le dos courbé, les mains croisées,
Triste, et le jour pour moi sera comme la nuit.

Je ne regarderai ni l'or du soir qui tombe,
Ni les voiles au loin descendant vers Harfleur,
Et quand j'arriverai, je mettrai sur ta tombe
Un bouquet de houx vert et de bruyère en fleur.

Écrit au lendemain de la mort de sa fille Léopoldine, ce poème avance à pas comptés, presque mécaniques, jusqu'à la chute silencieuse du dernier vers.`,
  },
  {
    id: "demo_baudelaire_albatros",
    titre: "L'Albatros",
    auteur: "Charles Baudelaire",
    dates_auteur: "1821-1867",
    type_genre: "Poésie",
    categories_tags: ["Genre: Poésie", "Forme: Poème", "19th century", "France"],
    tome: "Les Fleurs du Mal",
    sources_disponibles: ["gutenberg"],
    siecle: "XIXe siècle",
    mouvement_litteraire: "Symbolisme",
    texte_integral: `Souvent, pour s'amuser, les hommes d'équipage
Prennent des albatros, vastes oiseaux des mers,
Qui suivent, indolents compagnons de voyage,
Le navire glissant sur les gouffres amers.

À peine les ont-ils déposés sur les planches,
Que ces rois de l'azur, maladroits et honteux,
Laissent piteusement leurs grandes ailes blanches
Comme des avirons traîner à côté d'eux.

Ce voyageur ailé, comme il est gauche et veule !
Lui, naguère si beau, qu'il est comique et laid !
L'un agace son bec avec un brûle-gueule,
L'autre mime, en boitant, l'infirme qui volait !

Le Poète est semblable au prince des nuées
Qui hante la tempête et se rit de l'archer ;
Exilé sur le sol au milieu des huées,
Ses ailes de géant l'empêchent de marcher.`,
  },
  {
    id: "demo_verlaine_automne",
    titre: "Chanson d'automne",
    auteur: "Paul Verlaine",
    dates_auteur: "1844-1896",
    type_genre: "Poésie",
    categories_tags: ["Genre: Poésie", "Forme: Poème", "19th century", "France"],
    tome: "Poèmes saturniens",
    sources_disponibles: ["gutenberg"],
    siecle: "XIXe siècle",
    mouvement_litteraire: "Symbolisme",
    texte_integral: `Les sanglots longs
Des violons
De l'automne
Blessent mon cœur
D'une langueur
Monotone.

Tout suffocant
Et blême, quand
Sonne l'heure,
Je me souviens
Des jours anciens
Et je pleure ;

Et je m'en vais
Au vent mauvais
Qui m'emporte
Deçà, delà,
Pareil à la
Feuille morte.`,
  },
  {
    id: "demo_maupassant_ficelle",
    titre: "La Ficelle (ouverture)",
    auteur: "Guy de Maupassant",
    dates_auteur: "1850-1893",
    type_genre: "Roman",
    categories_tags: ["Genre: Nouvelle", "Forme: Nouvelle réaliste", "19th century", "France"],
    tome: "Contes du jour et de la nuit",
    sources_disponibles: ["gutenberg"],
    siecle: "XIXe siècle",
    mouvement_litteraire: "Réalisme",
    texte_integral: `Sur toutes les routes autour de Goderville, les paysans et leurs femmes s'en venaient vers le bourg, car c'était jour de marché. Les mâles allaient, à pas tranquilles, tout le corps en avant à chaque mouvement de leurs longues jambes torses, déformées par les rudes travaux, par la pesée sur la charrue qui fait en même temps monter l'épaule gauche et dévier la taille, par le fauchage des blés qui fait écarter les genoux pour prendre un aplomb solide, par toutes les besognes lentes et pénibles de la campagne.

Leur blouse bleue, empesée, brillante, comme vernie, ornée au col et aux poignets d'un petit dessin de fil blanc, gonflée autour de leur torse osseux, semblait un ballon prêt à s'envoler, d'où sortaient une tête, deux bras et deux pieds.

Les uns tiraient au bout d'une corde une vache, un veau. Et leurs femmes, derrière l'animal, lui fouettaient les reins d'une branche encore garnie de feuilles, pour hâter sa marche, et portaient sur le bras un grand panier d'où sortaient des têtes de poulets par-ci, des têtes de canards par-là.

[Extrait d'ouverture — texte intégral disponible dans le corpus complet.]`,
  },
  {
    id: "demo_rimbaud_dormeur",
    titre: "Le Dormeur du val",
    auteur: "Arthur Rimbaud",
    dates_auteur: "1854-1891",
    type_genre: "Poésie",
    categories_tags: ["Genre: Poésie", "Forme: Sonnet", "19th century", "France"],
    tome: "Poésies",
    sources_disponibles: ["gutenberg"],
    siecle: "XIXe siècle",
    mouvement_litteraire: "Symbolisme",
    texte_integral: `C'est un trou de verdure où chante une rivière
Accrochant follement aux herbes des haillons
D'argent ; où le soleil, de la montagne fière,
Luit : c'est un petit val qui mousse de rayons.

Un soldat jeune, bouche ouverte, tête nue,
Et la nuque baignant dans le frais cresson bleu,
Dort ; il est étendu dans l'herbe, sous la nue,
Pâle dans son lit vert où la lumière pleut.

Les pieds dans les glaïeuls, il dort. Souriant comme
Sourirait un enfant malade, il fait un somme :
Nature, berce-le chaudement : il a froid.

Les parfums ne font pas frissonner sa narine ;
Il dort dans le soleil, la main sur sa poitrine
Tranquille. Il a deux trous rouges au côté droit.`,
  },
  {
    id: "demo_genese_1",
    titre: "La Genèse, chapitre 1 (extrait)",
    auteur: "Anonyme (Bible, trad. Louis Segond, 1910)",
    dates_auteur: "Antiquité",
    type_genre: "Texte religieux",
    categories_tags: ["Genre: Texte religieux", "Domaine public", "Traduction 1910"],
    tome: "Ancien Testament",
    sources_disponibles: ["gutenberg"],
    siecle: "Antiquité",
    mouvement_litteraire: "—",
    texte_integral: `Au commencement, Dieu créa les cieux et la terre. La terre était informe et vide : il y avait des ténèbres à la surface de l'abîme, et l'esprit de Dieu se mouvait au-dessus des eaux.

Dieu dit : Que la lumière soit ! Et la lumière fut. Dieu vit que la lumière était bonne ; et Dieu sépara la lumière d'avec les ténèbres. Dieu appela la lumière jour, et il appela les ténèbres nuit. Ainsi, il y eut un soir, et il y eut un matin : ce fut le premier jour.

Dieu dit : Qu'il y ait une étendue entre les eaux, et qu'elle sépare les eaux d'avec les eaux. Et Dieu fit l'étendue, et il sépara les eaux qui sont au-dessous de l'étendue d'avec les eaux qui sont au-dessus de l'étendue. Et cela fut ainsi. Dieu appela l'étendue ciel. Ainsi, il y eut un soir, et il y eut un matin : ce fut le second jour.`,
  },
  {
    id: "demo_perrault_barbebleue",
    titre: "La Barbe bleue (ouverture)",
    auteur: "Charles Perrault",
    dates_auteur: "1628-1703",
    type_genre: "Contes & Fables",
    categories_tags: ["Genre: Conte merveilleux", "17th century", "France"],
    tome: "Histoires ou contes du temps passé",
    sources_disponibles: ["gutenberg"],
    siecle: "XVIIe siècle",
    mouvement_litteraire: "Classicisme",
    texte_integral: `Il était une fois un homme qui avait de belles maisons à la ville et à la campagne, de la vaisselle d'or et d'argent, des meubles en broderie et des carrosses tout dorés ; mais par malheur cet homme avait la barbe bleue : cela le rendait si laid et si terrible, qu'il n'était ni femme ni fille qui ne s'enfuît de devant lui.

Une de ses voisines, dame de qualité, avait deux filles parfaitement belles. Il lui en demanda une en mariage, et lui laissa le choix de celle qu'elle voudrait lui donner. Elles n'en voulaient point toutes deux, et se le renvoyaient l'une à l'autre, ne pouvant se résoudre à prendre un homme qui eût la barbe bleue.

[Extrait d'ouverture — texte intégral disponible dans le corpus complet.]`,
  },
  {
    id: "demo_proverbes",
    titre: "Proverbes et sagesse populaire (recueil court)",
    auteur: "Collectif / Tradition orale",
    dates_auteur: "—",
    type_genre: "Proverbes",
    categories_tags: ["Genre: Proverbes", "Domaine public", "France"],
    tome: "Unique",
    sources_disponibles: ["gutenberg"],
    siecle: "—",
    mouvement_litteraire: "—",
    texte_integral: `Petit à petit, l'oiseau fait son nid.

Il ne faut pas vendre la peau de l'ours avant de l'avoir tué.

Qui vole un œuf vole un bœuf.

Pierre qui roule n'amasse pas mousse.

L'habit ne fait pas le moine.

Chat échaudé craint l'eau froide.

Il n'est pire eau que l'eau qui dort.

Un tiens vaut mieux que deux tu l'auras.

À bon entendeur, salut.

Rien ne sert de courir ; il faut partir à point.`,
  },
];

function wordCount(txt) {
  return txt.trim().split(/\s+/).filter(Boolean).length;
}

const SQL = await initSqlJs({
  locateFile: (file) => path.resolve(__dirname, "../node_modules/sql.js/dist", file),
});

const db = new SQL.Database();
db.run(`
  CREATE TABLE oeuvres (
    id TEXT PRIMARY KEY,
    titre TEXT,
    auteur TEXT,
    dates_auteur TEXT,
    type_genre TEXT,
    categories_tags TEXT,
    tome TEXT,
    sources_disponibles TEXT,
    texte_integral TEXT,
    nb_mots INTEGER,
    nb_caracteres INTEGER,
    temps_lecture_min INTEGER,
    siecle TEXT,
    mouvement_litteraire TEXT
  );
`);

const insert = db.prepare(`
  INSERT INTO oeuvres (id, titre, auteur, dates_auteur, type_genre, categories_tags, tome,
    sources_disponibles, texte_integral, nb_mots, nb_caracteres, temps_lecture_min, siecle, mouvement_litteraire)
  VALUES (:id, :titre, :auteur, :dates_auteur, :type_genre, :categories_tags, :tome,
    :sources_disponibles, :texte_integral, :nb_mots, :nb_caracteres, :temps_lecture_min, :siecle, :mouvement_litteraire)
`);

const indexEntries = [];

for (const o of oeuvres) {
  const mots = wordCount(o.texte_integral);
  const caracteres = o.texte_integral.length;
  const minutes = Math.max(1, Math.round(mots / 180));
  insert.run({
    ":id": o.id,
    ":titre": o.titre,
    ":auteur": o.auteur,
    ":dates_auteur": o.dates_auteur,
    ":type_genre": o.type_genre,
    ":categories_tags": JSON.stringify(o.categories_tags),
    ":tome": o.tome,
    ":sources_disponibles": JSON.stringify(o.sources_disponibles),
    ":texte_integral": o.texte_integral,
    ":nb_mots": mots,
    ":nb_caracteres": caracteres,
    ":temps_lecture_min": minutes,
    ":siecle": o.siecle,
    ":mouvement_litteraire": o.mouvement_litteraire,
  });
  indexEntries.push({
    id: o.id,
    t: o.titre,
    a: o.auteur,
    d: o.dates_auteur,
    g: o.type_genre,
    tags: o.categories_tags,
    vol: o.tome,
    mots,
    min: minutes,
    sec: o.siecle,
    mouv: o.mouvement_litteraire,
    txt: 1,
    src: o.sources_disponibles,
  });
}
insert.free();

const rawBytes = db.export();
db.close();

// Compression (pako = gzip, mise en situation du pipeline LZMA réel décrit dans le cahier des charges)
const compressed = pako.gzip(rawBytes, { level: 9 });

// Découpage en segments
const NUM_CHUNKS = 4;
const chunkSize = Math.ceil(compressed.length / NUM_CHUNKS);
const manifestChunks = [];

for (let i = 0; i < NUM_CHUNKS; i++) {
  const start = i * chunkSize;
  const end = Math.min(start + chunkSize, compressed.length);
  if (start >= end) continue;
  const slice = compressed.subarray(start, end);
  const name = `corpus_part_${String(i + 1).padStart(2, "0")}.bin`;
  writeFileSync(path.join(OUT_DIR, name), slice);
  const hash = createHash("sha256").update(slice).digest("hex");
  manifestChunks.push({ name, bytes: slice.length, sha256: hash });
}

const manifest = {
  nom_projet: "Nomad Pocket Library — Corpus de démonstration",
  version: "poc-0.1.0",
  algo_compression: "gzip (DEFLATE) — remplace LZMA pour la démonstration",
  taille_brute_octets: rawBytes.length,
  taille_compresse_octets: compressed.length,
  nombre_chunks: manifestChunks.length,
  chunks: manifestChunks,
  generated_at: new Date().toISOString(),
  note: "Corpus réduit (10 œuvres/extraits domaine public) pour valider le pipeline import → vérification SHA-256 → décompression → SQLite WASM → lecture → TTS, avant mise à l'échelle sur les 5098 œuvres réelles.",
};

writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

const catalogIndex = indexEntries;
writeFileSync(path.join(OUT_DIR, "catalog_index.json"), JSON.stringify(catalogIndex, null, 2));

console.log("Corpus de démonstration généré avec succès :");
console.log(" - Base brute      :", rawBytes.length, "octets");
console.log(" - Base compressée :", compressed.length, "octets");
console.log(" - Chunks          :", manifestChunks.length);
console.log(" - Œuvres          :", oeuvres.length);
console.log(" - Dossier de sortie:", OUT_DIR);

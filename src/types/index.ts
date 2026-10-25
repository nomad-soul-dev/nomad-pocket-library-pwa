// Types partagés — Nomad Pocket Library (Étape 2)

export interface CatalogEntry {
  id: string;
  t: string; // titre
  a: string; // auteur
  d: string; // dates de l'auteur
  g: string; // genre
  tags: string[];
  vol: string; // tome / recueil
  mots: number;
  min: number; // temps de lecture estimé (minutes)
  sec: string; // siècle
  mouv: string; // mouvement littéraire
  txt: 0 | 1; // texte intégral disponible dans la base
  src: string[];
}

export interface Oeuvre {
  id: string;
  titre: string;
  auteur: string;
  dates_auteur: string;
  type_genre: string;
  categories_tags: string[];
  tome: string;
  sources_disponibles: string[];
  texte_integral: string;
  nb_mots: number;
  nb_caracteres: number;
  temps_lecture_min: number;
  siecle: string;
  mouvement_litteraire: string;
}

export interface ManifestChunk {
  name: string;
  bytes: number;
  sha256: string;
}

export interface CorpusManifest {
  nom_projet: string;
  version: string;
  algo_compression: string;
  taille_brute_octets: number;
  taille_compresse_octets: number;
  nombre_chunks: number;
  chunks: ManifestChunk[];
  generated_at: string;
  note: string;
}

export type ImportStage =
  | "idle"
  | "fetching-manifest"
  | "downloading"
  | "verifying"
  | "decompressing"
  | "writing-storage"
  | "opening-db"
  | "ready"
  | "error";

export interface ImportProgress {
  stage: ImportStage;
  chunkIndex: number;
  totalChunks: number;
  bytesDone: number;
  bytesTotal: number;
  message: string;
  log: string[];
}

export type StorageBackend = "opfs" | "indexeddb" | "none";

export type ThemeName = "nuit" | "sepia" | "matrix" | "clair";

export interface ReaderSettings {
  theme: ThemeName;
  fontSize: number;
  lineHeight: number;
  measure: number;
  ttsRate: number;
  ttsPitch: number;
  autoPlay: boolean;
  followText: boolean;
  voiceURI: string | null;
}

export interface ReadingPosition {
  oeuvreId: string;
  titre: string;
  auteur: string;
  paragraphIndex: number;
  unitIndex: number;
  percent: number;
  updatedAt: number;
}

// VFS SQLite « lecture seule » — Nomad Pocket Library (Étape 2)
//
// Pourquoi un VFS dédié plutôt que les VFS d'exemple de wa-sqlite :
//  1. Les VFS concrets (OriginPrivateFileSystemVFS, IDBMinimalVFS…) ne sont PAS
//     livrés dans le tarball npm de wa-sqlite 1.0.0 (dossier src/examples vide),
//     et ceux du dépôt GitHub dépendent d'une classe `FacadeVFS` non publiée.
//  2. Notre besoin est radicalement plus simple que le cas général : LIRE un
//     unique fichier immuable (oeuvres.db, 1,64 Go) déjà présent dans l'OPFS.
//     Aucune écriture, aucun journal, aucun verrou multi-processus, aucun
//     fichier temporaire. Un VFS court que l'on comprend entièrement est ici
//     plus sûr qu'un VFS générique de mille lignes.
//
// Conséquences majeures de ce choix :
//  - La base ne peut JAMAIS être corrompue par l'application (aucun code d'écriture).
//  - Aucune allocation contiguë de la base : SQLite lit page par page (4 Ko) via
//    le `SyncAccessHandle`, le cache de pages étant borné par `PRAGMA cache_size`.
//  - La mémoire consommée dépend du résultat de la requête, pas de la taille de
//    la base (contrairement à sql.js qui chargeait les 1,64 Go en RAM).
//
// Toute la partie asynchrone (résolution du fichier OPFS, ouverture du
// `FileSystemSyncAccessHandle`) est faite AVANT la construction du VFS, dans le
// Worker. Le VFS lui-même n'expose que des lectures synchrones, comme l'exige
// le build wa-sqlite (non-Asyncify).
//
// NB de compatibilité : les .d.ts du paquet décrivent `pData` comme un objet
// `{size, value}` alors que le glue minifié transmet en réalité un `Uint8Array`
// (sous-vue du tas WASM). On accepte les deux formes.

import * as VFS from "wa-sqlite/src/VFS.js";

/** Lecteur d'octets synchrone : un seul fichier, ouvert en lecture seule. */
export interface SyncByteReader {
  /** Lit dans `view` à partir de l'octet `at`. Retourne le nombre d'octets lus. */
  read(view: Uint8Array, at: number): number;
  /** Taille du fichier en octets. */
  size(): number;
  /** Libère la ressource (handle OPFS, etc.). */
  close(): void | Promise<void>;
}

/** `Uint8Array` nu, ou enveloppe `{size, value}` selon la version du glue. */
type ReadBuffer = Uint8Array | { size: number; value: Uint8Array };

function asView(data: ReadBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : data.value;
}

/**
 * VFS lecture seule pour un fichier unique déjà ouvert.
 *
 * Les fichiers de journal / temporaires sont refusés : la base est ouverte avec
 * SQLITE_OPEN_READONLY et `PRAGMA query_only = 1`, donc SQLite n'en demandera
 * jamais — sauf si une requête a besoin d'un tri débordant en mémoire. C'est
 * pourquoi le Worker force aussi `PRAGMA temp_store = MEMORY`.
 */
export class ReadOnlySingleFileVFS extends VFS.Base {
  readonly name: string;
  mxPathName = 64;

  private readonly files: Map<string, SyncByteReader>;
  private readonly openHandles = new Map<number, SyncByteReader>();

  constructor(name: string, files: Map<string, SyncByteReader>) {
    super();
    this.name = name;
    this.files = files;
    // Le build minifié de wa-sqlite lit une propriété interne (`g.Xc ?? 64`)
    // pour la longueur maximale de chemin, et non `mxPathName`. On l'expose
    // donc aussi pour que la valeur soit réellement prise en compte.
    (this as unknown as Record<string, number>).Xc = 512;
  }

  xOpen(path: string | null, fileId: number, flags: number, pOutFlags: DataView): number {
    try {
      if (!path) return VFS.SQLITE_CANTOPEN; // fichier temporaire anonyme : refusé

      const isJournal =
        (flags & VFS.SQLITE_OPEN_MAIN_JOURNAL) !== 0 ||
        (flags & VFS.SQLITE_OPEN_SUBJOURNAL) !== 0 ||
        (flags & VFS.SQLITE_OPEN_TEMP_JOURNAL) !== 0 ||
        (flags & VFS.SQLITE_OPEN_SUPER_JOURNAL) !== 0;
      const isTemp =
        (flags & VFS.SQLITE_OPEN_TEMP_DB) !== 0 || (flags & VFS.SQLITE_OPEN_TRANSIENT_DB) !== 0;
      if (isJournal || isTemp) return VFS.SQLITE_CANTOPEN;
      if (flags & VFS.SQLITE_OPEN_DELETEONCLOSE) return VFS.SQLITE_CANTOPEN;

      const reader = this.files.get(path);
      if (!reader) return VFS.SQLITE_CANTOPEN;

      if (flags & VFS.SQLITE_OPEN_CREATE) {
        // On ne crée jamais rien : si le fichier existe, on le rouvre tel quel.
        pOutFlags.setInt32(0, flags & ~VFS.SQLITE_OPEN_CREATE, true);
      } else {
        pOutFlags.setInt32(0, flags, true);
      }

      this.openHandles.set(fileId, reader);
      return VFS.SQLITE_OK;
    } catch {
      return VFS.SQLITE_CANTOPEN;
    }
  }

  xClose(fileId: number): number {
    this.openHandles.delete(fileId);
    return VFS.SQLITE_OK;
  }

  xRead(fileId: number, pData: ReadBuffer, iOffset: number): number {
    const reader = this.openHandles.get(fileId);
    if (!reader) return VFS.SQLITE_IOERR;

    const view = asView(pData);
    const offset = Number(iOffset);
    if (!Number.isFinite(offset) || offset < 0) return VFS.SQLITE_IOERR_READ;

    let read = 0;
    try {
      read = reader.read(view, offset);
    } catch {
      return VFS.SQLITE_IOERR_READ;
    }
    if (read < 0) return VFS.SQLITE_IOERR_READ;
    if (read < view.byteLength) {
      // SQLite exige que la zone non lue soit mise à zéro + SHORT_READ.
      view.fill(0, read);
      return VFS.SQLITE_IOERR_SHORT_READ;
    }
    return VFS.SQLITE_OK;
  }

  xWrite(): number {
    // Lecture seule : toute écriture est refusée explicitement.
    return VFS.SQLITE_READONLY;
  }

  xTruncate(): number {
    return VFS.SQLITE_READONLY;
  }

  xSync(): number {
    return VFS.SQLITE_OK;
  }

  xFileSize(fileId: number, pSize64: DataView): number {
    const reader = this.openHandles.get(fileId);
    if (!reader) return VFS.SQLITE_IOERR_FSTAT;
    try {
      pSize64.setBigInt64(0, BigInt(reader.size()), true);
      return VFS.SQLITE_OK;
    } catch {
      return VFS.SQLITE_IOERR_FSTAT;
    }
  }

  xLock(): number {
    return VFS.SQLITE_OK;
  }

  xUnlock(): number {
    return VFS.SQLITE_OK;
  }

  xCheckReservedLock(_fileId: number, pResOut: DataView): number {
    pResOut.setInt32(0, 0, true);
    return VFS.SQLITE_OK;
  }

  xSectorSize(): number {
    return 4096;
  }

  xDeviceCharacteristics(): number {
    // Le fichier ne peut pas être modifié pendant que l'application le lit :
    // c'est exactement la sémantique de SQLITE_IOCAP_IMMUTABLE, et cela permet
    // à SQLite de court-circuiter des vérifications inutiles.
    return VFS.SQLITE_IOCAP_IMMUTABLE;
  }

  xFileControl(): number {
    return VFS.SQLITE_NOTFOUND;
  }

  xAccess(path: string, _flags: number, pResOut: DataView): number {
    // Seuls les fichiers connus du VFS « existent ». Un journal (`…-journal`)
    // ne fait jamais partie de la liste : SQLite ne tentera donc aucune
    // restauration au démarrage, et l'ouverture reste strictement lisible.
    pResOut.setInt32(0, this.files.has(path) ? 1 : 0, true);
    return VFS.SQLITE_OK;
  }

  xDelete(): number {
    return VFS.SQLITE_READONLY;
  }

  /** Taille du fichier principal, pour affichage et contrôle d'intégrité. */
  mainFileSize(): number {
    for (const reader of this.files.values()) return reader.size();
    return 0;
  }

  /** Ferme tous les lecteurs (appelé à l'arrêt du Worker). */
  dispose(): void {
    this.openHandles.clear();
    for (const reader of this.files.values()) {
      void Promise.resolve(reader.close()).catch(() => undefined);
    }
    this.files.clear();
  }
}

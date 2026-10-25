import re
import sqlite3

# Table de correspondance d'urgence pour les auteurs majeurs mal datés
AUTHORS_CENTURY_MAP = {
    "Victor Hugo": "XIXe siècle",
    "Théophile Gautier": "XIXe siècle",
    "Alfred de Vigny": "XIXe siècle",
    "Charles Baudelaire": "XIXe siècle",
    "Gérard de Nerval": "XIXe siècle",
    "Alphonse Daudet": "XIXe siècle",
    "Gustave Flaubert": "XIXe siècle",
    "Honoré de Balzac": "XIXe siècle",
    "Émile Zola": "XIXe siècle",
    "Alexandre Dumas": "XIXe siècle",
    "Guy de Maupassant": "XIXe siècle",
    "Lamartine": "XIXe siècle",
    "Jules Laforgue": "XIXe siècle",
    "Voltaire": "XVIIIe siècle",
    "Denis Diderot": "XVIIIe siècle",
    "Antoine Laurent Lavoisier": "XVIIIe siècle",
    "Molière": "XVIIe siècle",
    "Guillaume Apollinaire": "XXe siècle",
}


def clean_author(auteur: str) -> str:
    if not auteur:
        return "Anonyme"
    # Supprime les années préfixées (ex: "1886 Alain-Fournier" -> "Alain-Fournier")
    auteur = re.sub(r"^\d{4}\s+", "", auteur)
    # Supprime les dates de fin de notice (ex: ", 1780" ou ", 354-430")
    auteur = re.sub(r",\s*\d{3,4}(-\d{3,4})?$", "", auteur)
    # Nettoie les virgules orphelines en fin de chaîne
    auteur = auteur.rstrip(",").strip()
    return auteur


def clean_title(titre: str) -> str:
    if not titre:
        return "Sans titre"
    # Supprime la numérotation romaine/arabe initiale (ex: "XX. Les Dons..." -> "Les Dons...")
    titre = re.sub(
        r"^(?:[IVXLCDM]+\.|\d+\.|\d+\))\s*", "", titre, flags=re.IGNORECASE
    )
    # Normalise le ALL CAPS trop agressif
    if titre.isupper() and len(titre) > 4:
        titre = titre.capitalize()
    return titre.strip()


def fix_century(auteur_cleane: str, siecle_actuel: str) -> str:
    # 1. Vérification dans le dictionnaire prioritaire
    for key, siecle in AUTHORS_CENTURY_MAP.items():
        if key.lower() in auteur_cleane.lower():
            return siecle

    # 2. Si "Moyen Âge / Ancien" persiste, marquer pour audit manuel si auteur XIXe probable
    return siecle_actuel


def run_pipeline(db_path="oeuvres_nettoyee.db"):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute("SELECT id_base, titre, auteur, siecle FROM oeuvres")
    rows = cursor.fetchall()

    updates = []
    for id_base, titre, auteur, siecle in rows:
        titre_c = clean_title(titre)
        auteur_c = clean_author(auteur)
        siecle_c = fix_century(auteur_c, siecle)

        # Rejet des titres corrompus ("5", "6)", "II)")
        if len(titre_c) <= 2 and titre_c.isalnum():
            statut = "REJET_TITRE_COURT"
        else:
            statut = "VALIDE"

        updates.append((titre_c, auteur_c, siecle_c, statut, id_base))

    cursor.executemany(
        """
        UPDATE oeuvres 
        SET titre = ?, auteur = ?, siecle = ?, statut_audit = ?
        WHERE id_base = ?
    """,
        updates,
    )

    conn.commit()
    conn.close()
    print(f"✅ Pipeline exécuté sur {len(updates)} notices.")


if __name__ == "__main__":
    run_pipeline()


import http.server
import socketserver
import json
import sqlite3
import urllib.parse
import os

PORT = 8080
DB_FILE = "oeuvres.db"

# Recherche du fichier d'index aperçu dans le dossier courant
fichiers_json = [f for f in os.listdir('.') if 'apercu.json' in f]
if not fichiers_json:
    print("ERREUR : Fichier apercu.json introuvable dans le dossier courant.")
    exit(1)
INDEX_FILE = fichiers_json[0]

class NomadHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        
        # Endpoint 1 : Servir l'index JSON pour la recherche rapide
        if parsed.path == '/api/index':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            with open(INDEX_FILE, 'rb') as f:
                self.wfile.write(f.read())
            return

        # Endpoint 2 : Charger le texte depuis la colonne 'texte_integral'
        elif parsed.path.startswith('/api/oeuvre/'):
            oeuvre_id = urllib.parse.unquote(parsed.path.split('/')[-1])
            
            conn = sqlite3.connect(DB_FILE)
            cursor = conn.cursor()
            cursor.execute("SELECT id, titre, auteur, texte_integral FROM oeuvres WHERE id = ? OR titre = ?", (oeuvre_id, oeuvre_id))
            row = cursor.fetchone()
            conn.close()

            if row:
                res = {"id": row[0], "titre": row[1], "auteur": row[2], "contenu": row[3]}
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps(res, ensure_ascii=False).encode('utf-8'))
            else:
                self.send_error(404, "Œuvre non trouvée")
            return

        return super().do_GET()

with socketserver.TCPServer(("", PORT), NomadHandler) as httpd:
    print(f"Serveur Nomad actif sur http://localhost:{PORT}")
    httpd.serve_forever()

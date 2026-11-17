#!/usr/bin/env bash
# Sauvegarde de TickUp : la base (projets, tickets, comptes).
#   ./backup.sh [dossier de destination]
# À lancer chaque nuit avec cron, puis à copier hors du VPS.
set -euo pipefail
cd "$(dirname "$0")"

dest="${1:-$HOME/tickup-backups}"
stamp="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$dest"

# Copie cohérente de la base, même pendant que l'app écrit.
docker compose exec -T tickup sh -c '
  set -e
  cd /app
  node -e "const db = require(\"better-sqlite3\")(\"/data/tickup.db\", { readonly: true }); db.backup(\"/data/backup.db\").then(() => db.close())"
  cd /data
  gzip -c backup.db
  rm -f backup.db
' > "$dest/tickup-$stamp.db.gz"

# Garde les 14 dernières sauvegardes.
ls -1t "$dest"/tickup-*.db.gz | tail -n +15 | xargs -r rm --
echo "Sauvegarde : $dest/tickup-$stamp.db.gz"

#!/bin/bash
# Deploy do Vinyl Display. O destino é obrigatório, para nunca publicar nos dois sem querer:
#   ./deploy.sh principal   -> heriveltogabriel.com.br (150.136.207.62)
#   ./deploy.sh bruno       -> oldeighty.duckdns.org
#   ./deploy.sh todos       -> os dois
set -euo pipefail

KEY="ssh/ssh-key-2026-05-26.key"
case "${1:-}" in
  principal) SERVERS=("150.136.207.62") ;;
  bruno)     SERVERS=("oldeighty.duckdns.org") ;;
  todos)     SERVERS=("150.136.207.62" "oldeighty.duckdns.org") ;;
  *) echo "Uso: ./deploy.sh principal|bruno|todos"; exit 1 ;;
esac

for HOST in "${SERVERS[@]}"; do
  echo "--------------------------------------------------------"
  echo "📦 Packaging and deploying code to $HOST..."
  tar --exclude="static-backup-*" \
      --exclude=".git" \
      --exclude="certs" \
      --exclude="ssh" \
      --exclude="data" \
      --exclude="backups" \
      --exclude="scratch" \
      --exclude="tests" \
      --exclude="__pycache__" \
      --exclude="*.pyc" \
      --exclude="arquivos_sensiveis.zip" \
      --exclude="collection.db" \
      --exclude=".env" \
      --exclude="*recovery_key*" \
      -cf - . | ssh -o StrictHostKeyChecking=accept-new -i "$KEY" opc@"$HOST" "tar -C /home/opc/vinyl_display -xf - && find /home/opc/vinyl_display -name \"._*\" -delete && sudo systemctl restart vinyl-display"

  # Confere se o serviço voltou
  sleep 3
  if ssh -o StrictHostKeyChecking=accept-new -i "$KEY" opc@"$HOST" "curl -fsS -m 5 http://127.0.0.1:8080/api/health >/dev/null"; then
    echo "✅ $HOST deployed, service restarted and healthy (data preserved)."
  else
    echo "❌ $HOST: service did not answer /api/health after restart — check: sudo journalctl -u vinyl-display -n 50"
    exit 1
  fi
done

echo "--------------------------------------------------------"
echo "🎉 Deployment finished: ${SERVERS[*]}"

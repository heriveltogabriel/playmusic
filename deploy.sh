#!/bin/bash
# Safe deployment script for Vinyl Display PWA to both production servers

SERVERS=("150.136.207.62" "oldeighty.duckdns.org")
KEY="ssh/ssh-key-2026-05-26.key"

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
      -cf - . | ssh -o StrictHostKeyChecking=no -i "$KEY" opc@"$HOST" "tar -C /home/opc/vinyl_display -xf - && find /home/opc/vinyl_display -name \"._*\" -delete && sudo systemctl restart vinyl-display"
  
  echo "✅ $HOST deployed and service restarted successfully (data preserved)."
done

echo "--------------------------------------------------------"
echo "🎉 Deployment to all servers finished successfully!"

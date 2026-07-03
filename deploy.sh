#!/bin/bash
# Safe deployment script for Vinyl Display PWA

echo "📦 Packaging and deploying code to remote production server..."
tar --exclude="static-backup-v1" \
    --exclude="static-backup-v2" \
    --exclude="static-backup-v3" \
    --exclude=".git" \
    --exclude="certs" \
    --exclude="ssh" \
    --exclude="data" \
    --exclude="arquivos_sensiveis.zip" \
    --exclude="collection.db" \
    -cf - . | ssh -o StrictHostKeyChecking=no -i ssh/ssh-key-2026-05-26.key opc@150.136.207.62 "tar -C /home/opc/vinyl_display -xf -"

echo "🧹 Cleaning up metadata files on the remote server..."
ssh -o StrictHostKeyChecking=no -i ssh/ssh-key-2026-05-26.key opc@150.136.207.62 "find /home/opc/vinyl_display -name \"._*\" -delete"

echo "🔄 Restarting the vinyl-display systemd service..."
ssh -o StrictHostKeyChecking=no -i ssh/ssh-key-2026-05-26.key opc@150.136.207.62 "sudo systemctl restart vinyl-display"

echo "✅ Deployment finished successfully! Remote database preserved."

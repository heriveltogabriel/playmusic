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
    -cf - . | ssh -i ssh/ssh-key-2026-05-26.key opc@152.70.194.246 "tar -C /home/opc/vinyl_display -xf -"

echo "🧹 Cleaning up metadata files on the remote server..."
ssh -i ssh/ssh-key-2026-05-26.key opc@152.70.194.246 "find /home/opc/vinyl_display -name \"._*\" -delete"

echo "🔄 Restarting the vinyl-display systemd service..."
ssh -i ssh/ssh-key-2026-05-26.key opc@152.70.194.246 "sudo systemctl restart vinyl-display"

echo "✅ Deployment finished successfully! Remote database preserved."

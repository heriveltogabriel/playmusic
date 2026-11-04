#!/bin/bash
# Deploy do Vinyl Display com rede de segurança.
#
#   ./deploy.sh principal            -> heriveltogabriel.com.br (150.136.207.62)
#   ./deploy.sh bruno                -> oldeighty.duckdns.org
#   ./deploy.sh todos                -> os dois
#   ./deploy.sh rollback principal   -> volta para a versão anterior guardada no servidor
#
# Antes de publicar: roda os testes (pule com SKIP_TESTS=1).
# No servidor: guarda a versão atual em ~/vinyl_releases (últimas 5), publica, reinicia e
# confere /api/health e a versão. Se o serviço não voltar, restaura a anterior sozinho.
set -uo pipefail

KEY="ssh/ssh-key-2026-05-26.key"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o BatchMode=yes -i "$KEY")
MODE="deploy"
if [ "${1:-}" = "rollback" ]; then
  MODE="rollback"
  shift
fi
case "${1:-}" in
  principal) SERVERS=("150.136.207.62") ;;
  bruno)     SERVERS=("oldeighty.duckdns.org") ;;
  todos)     SERVERS=("150.136.207.62" "oldeighty.duckdns.org") ;;
  *) echo "Uso: ./deploy.sh [rollback] principal|bruno|todos"; exit 1 ;;
esac

remote() { ssh "${SSH_OPTS[@]}" opc@"$1" "$2"; }

# Espera o serviço responder e confere a versão (até ~30 s)
healthy() {
  local host="$1" expected="${2:-}"
  remote "$host" "for i in \$(seq 1 15); do
      if curl -fsS -m 3 http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
        v=\$(cat /home/opc/vinyl_display/version.txt 2>/dev/null)
        if [ -z '$expected' ] || [ \"\$v\" = '$expected' ]; then exit 0; fi
      fi
      sleep 2
    done; exit 1"
}

restore_previous() {
  local host="$1"
  remote "$host" 'set -e
    LAST=$(ls -1t /home/opc/vinyl_releases/*.tgz 2>/dev/null | head -1)
    [ -n "$LAST" ] || { echo "nenhuma versão anterior guardada"; exit 1; }
    tar -C /home/opc/vinyl_display -xzf "$LAST"
    sudo systemctl restart vinyl-display
    echo "restaurado: $(basename "$LAST")"'
}

if [ "$MODE" = "rollback" ]; then
  for HOST in "${SERVERS[@]}"; do
    echo "↩️  Voltando $HOST para a versão anterior..."
    restore_previous "$HOST" && healthy "$HOST" && echo "✅ $HOST restaurado e respondendo." || { echo "❌ $HOST não respondeu depois do rollback"; exit 1; }
  done
  exit 0
fi

VERSION="$(cat version.txt)"

if [ "${SKIP_TESTS:-0}" != "1" ]; then
  echo "🧪 Rodando os testes antes do deploy..."
  if ! python3 -m unittest discover >/tmp/vinyl-deploy-tests.log 2>&1; then
    tail -20 /tmp/vinyl-deploy-tests.log
    echo "❌ Testes falharam: deploy cancelado. (SKIP_TESTS=1 para forçar)"
    exit 1
  fi
  echo "   $(grep -E '^Ran ' /tmp/vinyl-deploy-tests.log)"
fi

ARCHIVE="$(mktemp -t vinyl-deploy.XXXXXX)"
# tar devolve 1 quando um arquivo muda durante a leitura (ex.: __pycache__): é só aviso
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
    -cf "$ARCHIVE" .
TAR_STATUS=$?
if [ "$TAR_STATUS" -gt 1 ]; then
  echo "❌ tar failed with status $TAR_STATUS"; rm -f "$ARCHIVE"; exit 1
fi

for HOST in "${SERVERS[@]}"; do
  echo "--------------------------------------------------------"
  echo "📦 Publicando $VERSION em $HOST..."

  # 1. Guarda a versão que está no ar
  remote "$HOST" 'mkdir -p /home/opc/vinyl_releases && cd /home/opc/vinyl_display &&
    OLD=$(cat version.txt 2>/dev/null || echo desconhecida) &&
    tar -czf "/home/opc/vinyl_releases/$(date +%Y%m%d-%H%M%S)-$OLD.tgz" \
      --exclude=./data --exclude=./backups --exclude=./.env --exclude=./certs --exclude=./ssh \
      --exclude="*/__pycache__" . &&
    ls -1t /home/opc/vinyl_releases/*.tgz | tail -n +6 | xargs -r rm -f &&
    echo "   versão anterior guardada: $OLD"' || { echo "❌ não consegui guardar a versão atual de $HOST: deploy cancelado"; exit 1; }

  # 2. Publica e reinicia
  if ! ssh "${SSH_OPTS[@]}" opc@"$HOST" "tar -C /home/opc/vinyl_display -xf - && find /home/opc/vinyl_display -name '._*' -delete && sudo systemctl restart vinyl-display" < "$ARCHIVE"; then
    echo "❌ falha ao publicar em $HOST; restaurando a versão anterior..."
    restore_previous "$HOST"; rm -f "$ARCHIVE"; exit 1
  fi

  # 3. Confere e, se não voltar, desfaz
  if healthy "$HOST" "$VERSION"; then
    echo "✅ $HOST no ar com $VERSION (dados preservados)."
  else
    echo "❌ $HOST não respondeu com $VERSION. Últimas linhas do log:"
    remote "$HOST" "sudo journalctl -u vinyl-display -n 15 --no-pager -o cat" || true
    echo "↩️  Restaurando a versão anterior..."
    restore_previous "$HOST" && healthy "$HOST" && echo "✅ $HOST voltou para a versão anterior e está respondendo."
    rm -f "$ARCHIVE"
    exit 1
  fi
done

rm -f "$ARCHIVE"
echo "--------------------------------------------------------"
echo "🎉 Deploy concluído: ${SERVERS[*]}"

# Backup OCI do Vinyl Display

Este projeto usa SQLite em `data/vinyl_display.sqlite3`. Para evitar perda de dados, o caminho recomendado e manter snapshots no Oracle Cloud Infrastructure Object Storage.

O servidor principal no OCI deve enviar backups automaticamente para um bucket. Outras maquinas podem restaurar a partir desse bucket quando necessario.

## O que entra no backup

Por padrao, `scripts/backup_oci.sh` inclui:

- `data/vinyl_display.sqlite3`, gerado com `sqlite3 .backup`
- outros arquivos de `data/`, como `auth.json` e `recovery_key.txt`
- `manifest.env`, com dados basicos de origem

Por padrao, o backup nao inclui `.env` nem `certs/`, porque `.env` pode conter tokens. Se precisar incluir esses arquivos, use:

```bash
INCLUDE_ENV=1 INCLUDE_CERTS=1 OCI_BACKUP_BUCKET=vinyl-display-backups ./scripts/backup_oci.sh
```

Use essa opcao apenas se o bucket estiver bem protegido ou se o pacote for criptografado antes do upload.

## Criar bucket

No OCI Console:

1. Abra Object Storage.
2. Crie um bucket, por exemplo `vinyl-display-backups`.
3. Mantenha o bucket privado.
4. Ative uma regra de lifecycle para expirar objetos antigos se quiser controlar custo.

Sugestao de retencao:

- backups diarios por 30 dias
- backups semanais por 12 semanas
- backups mensais por 12 meses

## Permissao recomendada no OCI

No servidor principal OCI, prefira Instance Principal. Assim a VM envia backups sem chave de API salva em disco.

1. Crie um Dynamic Group para a instancia principal.
2. Crie uma Policy no compartment do bucket.

Exemplo de Dynamic Group por OCID da instancia:

```text
ALL {instance.id = 'ocid1.instance.oc1...'}
```

Exemplo de Policy:

```text
Allow dynamic-group vinyl-display-backup-instances to read buckets in compartment <nome-do-compartment> where target.bucket.name = 'vinyl-display-backups'
Allow dynamic-group vinyl-display-backup-instances to manage objects in compartment <nome-do-compartment> where target.bucket.name = 'vinyl-display-backups'
```

Depois instale o OCI CLI na VM principal e teste:

```bash
oci --auth instance_principal os ns get
```

## Backup manual

No servidor principal:

```bash
cd /home/opc/vinyl_display
OCI_BACKUP_BUCKET=vinyl-display-backups ./scripts/backup_oci.sh
```

Se seu diretorio ou usuario forem diferentes:

```bash
cd /home/lpdasemana/vinyl_display
PROJECT_DIR=/home/lpdasemana/vinyl_display OCI_BACKUP_BUCKET=vinyl-display-backups ./scripts/backup_oci.sh
```

O script envia dois objetos:

```text
oracle-primary/daily/playmusic-backup-YYYYMMDD-HHMMSS.tgz
oracle-primary/latest.tgz
```

## Agendar backup diario

No servidor principal OCI:

```bash
cd /home/opc/vinyl_display
OCI_BACKUP_BUCKET=vinyl-display-backups ./scripts/install_oci_backup_timer.sh
```

Por padrao, o backup roda todo dia as 03:00, com ate 10 minutos de atraso aleatorio.

Para mudar o horario:

```bash
OCI_BACKUP_BUCKET=vinyl-display-backups \
BACKUP_ON_CALENDAR="*-*-* 02:30:00" \
./scripts/install_oci_backup_timer.sh
```

Comandos uteis:

```bash
sudo systemctl list-timers 'vinyl-display-backup.timer'
sudo systemctl start vinyl-display-backup.service
sudo journalctl -u vinyl-display-backup.service -n 100 --no-pager
```

## Restaurar no servidor OCI

Para restaurar o ultimo backup:

```bash
cd /home/opc/vinyl_display
OCI_BACKUP_BUCKET=vinyl-display-backups ./scripts/restore_oci.sh
```

Para restaurar um backup especifico:

```bash
cd /home/opc/vinyl_display
OCI_BACKUP_BUCKET=vinyl-display-backups \
./scripts/restore_oci.sh oracle-primary/daily/playmusic-backup-YYYYMMDD-HHMMSS.tgz
```

O restore:

1. baixa o pacote do bucket
2. valida o SQLite com `PRAGMA integrity_check`
3. para o servico `vinyl-display`, se existir
4. salva um pacote local `backups/oci/pre-restore-*.tgz`
5. restaura `data/`
6. sobe o servico novamente

## Restaurar em outra maquina

Em uma maquina fora do OCI, Instance Principal nao funciona. Configure o OCI CLI com API key:

```bash
oci setup config
```

Depois rode o restore sem `instance_principal`:

```bash
cd /home/lpdasemana/vinyl_display
OCI_CLI_AUTH= \
OCI_BACKUP_BUCKET=vinyl-display-backups \
./scripts/restore_oci.sh
```

Se usar profile:

```bash
OCI_CLI_AUTH= \
OCI_CLI_PROFILE=DEFAULT \
OCI_BACKUP_BUCKET=vinyl-display-backups \
./scripts/restore_oci.sh
```

Depois confira:

```bash
curl -ksS https://127.0.0.1:8080/api/health
```

## Variaveis principais

| Variavel | Uso | Padrao |
| --- | --- | --- |
| `OCI_BACKUP_BUCKET` | bucket de destino/origem | obrigatoria |
| `OCI_BACKUP_PREFIX` | pasta logica dentro do bucket | `oracle-primary` |
| `OCI_CLI_AUTH` | modo de autenticacao OCI CLI | `instance_principal` |
| `OCI_CLI_PROFILE` | profile OCI CLI para API key | vazio |
| `OCI_CLI_REGION` | regiao OCI | vazio |
| `OCI_NAMESPACE` | namespace Object Storage | vazio |
| `PROJECT_DIR` | diretorio do projeto | pai da pasta `scripts/` |
| `LOCAL_RETENTION_DAYS` | retencao local dos `.tgz` | `7` |
| `INCLUDE_ENV` | inclui `.env` no backup | `0` |
| `INCLUDE_CERTS` | inclui `certs/` no backup | `0` |

## Observacoes de seguranca

- Mantenha o bucket privado.
- Use Instance Principal no servidor OCI principal.
- Evite incluir `.env` no backup sem criptografia.
- Nao restaure backup em duas maquinas que vao escrever ao mesmo tempo no mesmo catalogo. O modelo seguro e um servidor principal gravando e maquinas secundarias restaurando snapshots.

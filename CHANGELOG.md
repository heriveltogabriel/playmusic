# Changelog

Versões do PlayVinil / Vinyl Display. As mais recentes primeiro.

## 3.9.0 — 2026-11-04 — Menos Shazam, mais controle

### Plano B sem Shazam
- Botão do disco no topo do player: escolha o disco (Escuta da Semana primeiro, ou busque na coleção) e o lado. O tempo começa ali e o detector de silêncio acompanha faixas e viradas, sem nenhuma chamada ao Shazam.
- Quando o Shazam fica sem cota, o player sugere usar esse botão.

### Painel de reconhecimento (admin → Reconhecimento)
- Chamadas ao Shazam por dia e por disco, chamadas por disco, trocas resolvidas pelo silêncio, taxa de acerto e os últimos eventos.

### Bot do Telegram
- Comandos `/tocando`, `/semana`, `/status` e `/ajuda`, respondidos só para o seu chat.
- Resumo da semana no domingo, a partir das 10:05: discos ouvidos, Escuta da Semana, uso do Shazam e a nova agenda.

## 3.8.0 — 2026-11-04 — Operação

- `deploy.sh principal|bruno|todos`: roda os testes, guarda a versão no ar em `~/vinyl_releases` (5 últimas), confere saúde e versão e volta sozinho se algo falhar. `./deploy.sh rollback principal` volta para a anterior.
- Sync diário do Discogs (04:00) com aviso no Telegram se falhar; backup avisa se falhar.
- Logs do serviço guardados por 90 dias.

## 3.7.3 — 2026-11-04 — Player que se cuida

### Alertas no Telegram (ou ntfy)
- Card **Player e alertas** em Configurações: token do bot, botão **Detectar** (acha o chat depois do `/start`), tópico do ntfy opcional e **Enviar teste**.
- Avisos: player sem sinal há 10 min, microfone pausado há 5 min, sync diário ou backup com falha, chave do Shazam em 80% ou esgotada. Cada aviso não se repete por algumas horas e há um aviso de "voltou" quando o problema se resolve.
- **Não perturbe** (padrão 22:00–10:00): avisos do player esperam o fim do silêncio; os demais chegam sem som.

### Player
- Heartbeat a cada minuto; o admin mostra "Player online · visto há 20 s · microfone ouvindo · versão".
- Recarrega sozinho quando sai versão nova no servidor, só sem disco tocando.
- Tenta ligar o microfone sozinho ao abrir quando a permissão já existe.
- Guia `docs/quiosque-android.md` para o celular abrir o player sozinho (Chrome instalado ou Fully Kiosk).

### Admin
- Chaves do Shazam e token do Telegram em campo de texto visível.

## 3.6.3 — 2026-11-04

### Coletâneas e discos ao vivo
- A escolha de disco é lembrada: ao trocar de disco (ou tocar em **Manter este disco**), a música fica associada a ele e, da próxima vez, o player já abre e trava nesse disco.
- Botão **Manter este disco** no popup de alternativas.
- Ao trocar de disco, a audição já contada vai para o disco escolhido.
- Alternativas só aparecem com o mesmo título de faixa (sem "Help" × "Help Me Rhonda").

### Detector de silêncio
- O início da faixa é medido pelo silêncio da sala, não pelo volume da música: introduções suaves não atrasam mais o lado.
- Em LP duplo/caixa a virada chama o Shazam uma vez (B→A ou B→C); em LP simples continua sem Shazam.
- Pausa clara fora de qualquer troca de faixa prevista confere com o Shazam na hora.

### Player
- Título longo limitado a 2 linhas e com fonte menor; artista e álbum em uma linha. Os controles e a versão não saem mais da tela.

### Segurança
- **Aparelhos autorizados** em Configurações: autorizar, listar e revogar aparelhos; opção (desligada por padrão) de exigir aparelho autorizado para o Shazam, o playback e o Ouvir.

## 3.5.2 — 2026-11-04
- Tela do celular fica acesa enquanto há um disco no player (Screen Wake Lock).

## 3.5.0 — 2026-11-04 — Player sem Next
- Detector de silêncio no celular: a pausa entre faixas confirma a troca e corrige o tempo; a virada de lado é percebida sozinha, sem Shazam.
- O Shazam não é mais chamado a cada faixa; só no início do disco, quando algo não bate ou se a virada não for percebida em 2 minutos.
- O disco que está tocando é salvo e volta depois de um restart ou deploy.
- A chave de recuperação do admin é mostrada uma vez e não fica mais gravada em texto no servidor.

## 3.4.0 — 2026-11-04 — Base segura e medida
- Shazam: várias chaves separadas por vírgula com troca automática quando a cota acaba, contador por chave no admin e limite diário.
- Registro de todas as tentativas de reconhecimento (`recognition_events`).
- Sync diário do Discogs por comando local (`python -m vinyl_display.sync`) no cron; falhas aparecem no admin.
- Microfone não entra mais em "repouso": espera crescente de 8 s a 5 min.
- Porta 8080 só local, rota de debug removida, cookie de sessão `Secure`, `deploy.sh` com destino obrigatório.

## 3.3.20 — 2026-11-04
- Detecção de lado para posições como `LP-A1`, `7"-E1` e tracklists numéricas de vinil.
- Durações de faixa ausentes preenchidas pelo MusicBrainz (script de backfill e aprendizado pelo ISRC do Shazam).

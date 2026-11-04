# Changelog

Versões do PlayVinil / Vinyl Display. As mais recentes primeiro.

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

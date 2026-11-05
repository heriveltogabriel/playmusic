# Changelog

Versões do PlayVinil / Vinyl Display. As mais recentes primeiro.

## 4.5.1 — 2026-11-05

- Shazam: trechos quietos no meio de uma música não contam mais como troca de disco (no meio do lado, só pausa de 20s ou mais); faixa já confirmada pela pausa não dispara outra conferência.

## 4.5.0 — 2026-11-05

- Novo nome: PlayVinil, com ícone próprio (toca-discos laranja) no celular, na aba do navegador e no app instalado.
- Nome da coleção configurável em Configurações → Coleção (aparece no player e no menu do admin).
- Tela inicial: sem disco tocando a capa fica centralizada; ao tocar ela desliza e o disco sai de dentro.
- Microfone menos sensível a conversa: a escuta automática só dispara com som contínuo, e as tentativas sem resultado esperam de 30s até 10 min.
- Títulos "Vinyl Display" trocados por PlayVinil no player e no login.

## 4.4.6 — 2026-11-05

- Página do artista no celular: "Seus discos" em lista (capa pequena, título, ano e audições) e mosaico do topo menor.

## 4.4.5 — 2026-11-05

- Página do artista: biografia em português pela Wikipédia (achada pelo número do artista no Discogs, via Wikidata), com a fonte e o link. Sem página em português, fica o texto do Discogs em inglês.

## 4.4.4 — 2026-11-05

- Ranking: histórico de audições com atalhos de período (1 mês, 3 meses, 6 meses, 1 ano, tudo) no lugar das duas listas de meses.
- Top LPs Mais Tocados abre em "Geral".

## 4.4.3 — 2026-11-05

- Ranking: "Resgate da Estante" removido; Top LPs Mais Tocados mostra 10 discos.

## 4.4.2 — 2026-11-05 — Ranking no celular

- "Discos ouvidos": Semana, Mês e Total lado a lado (o Total caía sozinho embaixo).
- Histórico de audições com menos recuo e nome/artista sem quebrar em várias linhas.

## 4.4.1 — 2026-11-05 — Escuta da Semana em lista

- Os 7 dias da semana numa lista (dia e data, capa, disco, situação, "Ouvi" e trocar disco); tocar abre a ficha.
- Painel "Disco selecionado" removido.
- Histórico de agendas: a semana atual saiu da lista de baixo; as semanas anteriores abrem no mesmo formato de lista.

## 4.4.0 — 2026-11-05 — Letra sincronizada com ajuste

- Letra volta a ser a sincronizada sobre a capa (o modo leitura em tela cheia saiu).
- Ajuste fino por música: −0,5 s / +0,5 s, tocar no verso que está tocando acerta a letra por ele; o ajuste fica guardado no celular do player. O ajuste geral voltou para Configurações → Player e alertas.
- Com o celular deitado, a letra ocupa a capa e o disco que gira ao lado.

## 4.3.2 — 2026-11-05 — Correção do reconhecimento

- Player volta a gravar o trecho para o Shazam com o método antigo (ScriptProcessor). Com o AudioWorklet da 4.0 o Shazam não reconhecia os trechos gravados no celular.

## 4.3.1 — 2026-11-05 — Celular

- Telas do admin sem corte à direita no celular (Estatísticas, Diário, Cuidados, Ranking, ficha do disco); tabelas do Reconhecimento rolam para o lado.
- Pódio do Ranking lado a lado; abas das Configurações e Prateleiras numa linha que rola; filtros da coleção atrás de um botão "Filtros (n)"; perfil do artista com "ler mais".
- Player: janela de escolher o disco cabe no celular em pé e deitado.

## 4.3.0 — 2026-11-05 — Edição em vinil

- **Edição em vinil**: disco cadastrado no Discogs como CD ou arquivo pode usar, no PlayVinil, os dados de uma prensagem em vinil (faixas com lados, durações, capa, selo, país). O item do Discogs não muda: data de cadastro, audições, notas e prateleiras ficam. Dá para trocar de prensagem ou voltar à edição do Discogs pela ficha do disco.

## 4.2.0 — 2026-11-05 — Letra para ler, admin novo e menos Shazam

### Player
- Letra em modo leitura: tela cheia, texto corrido e rolagem que acompanha a faixa; só aceita letra com a mesma duração da faixa.

### Admin
- **Minha Coleção**: filtros por gênero, década (ano original), país, formato, nunca ouvidos e favoritos; modo lista.
- **Ranking** fica com a escuta (pódio, mais tocados, resgate da estante, gráfico de 6 meses, histórico).
- **Estatísticas** ficam com o perfil da coleção (gêneros, décadas, países, edições) e o mapa "Quando você ouve"; tocar numa barra abre a coleção filtrada.
- **Diário da Vitrola** (novo): sessões por dia com discos, lados e faixas que o player acompanhou; faixas mais tocadas.
- **Audição automática sem duplicar**: o mesmo disco voltando ao prato dentro da duração dele (mínimo 1 h) + 30 min conta como a mesma audição (lados fora de ordem, parar e retomar). Fica registrado como `audition_merged` no Reconhecimento.
- **Menos chamadas ao Shazam**: a conferência de "pausa fora do previsto" vale uma vez por faixa (trechos quietos da mesma música não chamam de novo); faixa sem duração no Discogs é conferida no máximo uma vez, em vez de a cada 90 s; chamada automática até 2 min depois de o Shazam confirmar o disco é recusada pelo servidor sem gastar cota (o botão manual sempre passa).
- **Motivo de cada chamada** registrado e mostrado em Reconhecimento → "Por que o Shazam foi chamado".
- `fill_missing_durations.py` busca faixa a faixa no MusicBrainz quando o disco inteiro não bate.
- **Avaliação por estrelas** removida do admin (ficha, formulário e ordenações).
- **Linha do Tempo**: atalhos de período (6 meses, 1 ano, tudo) e a origem de cada disco (notas do Discogs).
- **Prateleiras** no lugar de Favoritos: Favoritos + listas suas (Festa, Domingo de manhã, Emprestados de início), com nota por disco; marcar pela ficha; ordenar por mais ouvidos, ouvido recentemente ou há mais tempo.
- **Configurações em abas**: Sistema (versão, player, último sync, último backup, Shazam, alertas, banco), Coleção, APIs, Player e alertas, Segurança. O ajuste de tempo da letra saiu (o modo leitura não usa).
- **Artistas** (novo): lista de artistas da coleção e a página de cada um (seus discos, audições, horas, faixas mais tocadas, perfil e discografia do Discogs com o que você tem e o que falta; guardada por 30 dias). O nome do artista na ficha do disco abre a página.
- **Agulha e Cuidados** (novo): horas de agulha, vida útil, previsão de troca, histórico de agulhas e limpeza de cada disco.

## 4.0.1 — 2026-11-04 — Servidor do Bruno em dia

- `scripts/backup_oci.sh` ganhou `BACKUP_UPLOAD=0`: backup só local, para servidor sem bucket do OCI.
- Servidor do Bruno com sync diário, backup diário local, app ouvindo só localmente e logs guardados.

## 4.0.0 — 2026-11-04 — Casa arrumada

Sem mudança no jeito de usar; é a base para as próximas versões.

- **Acesso declarado num lugar só** (`vinyl_display/routes.py`): cada rota da API diz se é pública, do player autorizado ou do admin. Rota nova que ninguém declarou fica fechada (exige admin), nunca aberta.
- **Admin dividido por tela** (`static/admin/00-core.js` … `95-recognition.js`), com versão na URL para o navegador não usar arquivo velho.
- **Captura do trecho com AudioWorklet**, fora da thread da tela; se o aparelho não suportar, usa o método antigo automaticamente.
- `pyproject.toml` alinhado ao Python 3.9 dos servidores.

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

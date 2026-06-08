# Vinyl Display - Design do MVP

## Objetivo

Construir um display de música para o espaço da vitrola usando um OnePlus 5 com Android 10.1 como tela e microfone, e um Raspberry Pi como servidor local.

O sistema deve reconhecer a música que está tocando no ambiente, cruzar o resultado apenas com a coleção pública do Discogs do usuário `heriveltogabriel`, e exibir uma interface minimalista com capa, faixa, artista, álbum e progresso. Se o disco não existir na coleção, o sistema deve avisar que ele precisa ser cadastrado no Discogs e sincronizado novamente.

## Escopo do MVP

- O Raspberry Pi sincroniza a coleção pública do Discogs.
- O OnePlus abre uma PWA/web app local em tela cheia.
- A PWA usa o microfone do celular e envia trechos curtos de áudio ao Raspberry Pi.
- O Raspberry Pi chama AudD como API inicial de reconhecimento musical.
- O Raspberry Pi cruza a faixa reconhecida com o catálogo local vindo do Discogs.
- O display mostra somente discos encontrados na coleção do usuário.
- O sistema acompanha faixa a faixa usando a tracklist e duração do release no Discogs.
- O usuário pode sincronizar a coleção novamente depois de cadastrar um novo disco.

Fora do MVP:

- App Android nativo.
- Microfone USB conectado diretamente ao Raspberry Pi.
- Busca genérica de capas fora da coleção.
- Controle da vitrola ou do receiver.
- Login Discogs com token pessoal.

## Arquitetura

### OnePlus 5

Responsabilidades:

- Abrir a interface local servida pelo Raspberry Pi.
- Pedir permissão de microfone ao usuário.
- Capturar pequenos trechos de áudio quando houver música.
- Enviar os trechos ao servidor.
- Renderizar a interface minimalista em tela cheia.

Observação: por usar microfone no navegador, a PWA precisa rodar em contexto seguro. O MVP deve usar HTTPS local no Raspberry Pi ou outro caminho equivalente aceito pelo Chrome/Android para `getUserMedia`.

### Raspberry Pi

Responsabilidades:

- Servir a PWA.
- Manter um banco local da coleção do Discogs.
- Sincronizar a coleção pública do usuário `heriveltogabriel`.
- Guardar release ID, artista, álbum, ano, país, selo, número de catálogo, formatos, imagens, tracklist, posições e durações.
- Receber trechos de áudio do celular.
- Chamar a API de reconhecimento musical.
- Fazer o match do resultado contra a coleção local.
- Publicar o estado atual para o display.

## Fluxo de Dados

1. O Raspberry Pi sincroniza `https://api.discogs.com/users/heriveltogabriel/collection/folders/0/releases`.
2. Para cada release, o Raspberry Pi busca os detalhes completos em `https://api.discogs.com/releases/{release_id}`.
3. O servidor salva uma cópia local normalizada do catálogo.
4. O OnePlus abre a interface local.
5. A interface detecta áudio no microfone e envia um trecho curto ao Raspberry Pi.
6. O Raspberry Pi envia esse trecho para AudD ou ACRCloud.
7. O resultado da API é normalizado por artista, título da faixa e álbum quando disponível.
8. O servidor procura correspondência na coleção local.
9. Se encontrar, publica o estado `playing`.
10. Se não encontrar, publica o estado `not_found`.
11. Enquanto o disco toca, o servidor usa duração e posição de faixa para estimar o progresso e a próxima faixa.
12. Ao detectar silêncio longo, o sistema volta para `listening` ou assume troca de lado.

## Estratégia de Reconhecimento

O sistema não deve chamar a API continuamente. Para reduzir custo e ruído:

- Reconhecer ao detectar início de música.
- Revalidar perto do fim previsto da faixa.
- Revalidar após silêncio longo.
- Revalidar se o usuário pular a agulha manualmente.
- Evitar novas chamadas enquanto a faixa estimada ainda estiver consistente.

O reconhecimento por áudio é usado para identificar a faixa. A edição correta do disco vem do Discogs, limitada à coleção do usuário.

## Catálogo Discogs

A coleção pública do usuário tem 240 itens no folder `All`. A API pública fornece dados básicos de cada item, incluindo capa, artista, título, ano, formato, selo e release ID. Os detalhes de cada release fornecem tracklist, posições como `A1` e `B1`, durações e imagens.

O catálogo local deve ser a fonte principal para:

- Capa exibida.
- Nome do álbum.
- Artista.
- Tracklist.
- Lado e número da faixa.
- Ano, país, selo e número de catálogo em telas futuras.

Se uma faixa reconhecida não corresponder a nenhum release local, a interface deve mostrar:

> Disco não encontrado na sua coleção. Cadastre no Discogs e sincronize novamente.

## Interface

Direção escolhida: **Opção 1 - Minimalista**.

Orientação do MVP: tela fixa em paisagem no OnePlus 5.

Princípios:

- Capa grande como elemento dominante.
- Pouca informação na tela principal.
- Legibilidade boa a distância.
- Visual escuro, amigável para AMOLED.
- Brilho moderado e pequenos deslocamentos/variações para reduzir risco de burn-in.
- Nada com cara de dashboard ou app administrativo.

Tela principal `playing`:

- Capa do disco ocupando a maior parte da tela.
- Título da faixa em destaque.
- Artista abaixo.
- Linha compacta com álbum, posição e tempo, por exemplo `Abbey Road · A1 · 0:42 / 4:21`.
- Barra de progresso fina.
- Próxima faixa em tamanho discreto quando houver espaço sem prejudicar a leitura principal.

Estados:

- `idle`: aguardando música.
- `listening`: ouvindo o ambiente.
- `identifying`: identificando trecho.
- `playing`: exibindo disco e faixa atual.
- `side_pause`: silêncio detectado, aguardando próximo lado.
- `not_found`: disco não encontrado na coleção.
- `syncing`: sincronizando coleção Discogs.
- `offline`: sem conexão com o Raspberry Pi ou com APIs externas.

Interação:

- Toque simples abre detalhes do disco.
- Tela de detalhes mostra release, ano, país, selo, catálogo, formato e tracklist.
- Botão discreto para sincronizar coleção.
- Botão discreto para tentar identificar novamente.

## Tratamento de Erros

- Microfone negado: mostrar instrução curta para permitir microfone no navegador.
- HTTPS/local seguro ausente: bloquear captura e mostrar mensagem de configuração.
- API de reconhecimento indisponível: manter tela em `listening` e mostrar status discreto.
- Discogs indisponível durante sync: manter catálogo local anterior.
- Capa indisponível: usar placeholder escuro com artista e álbum.
- Duração ausente na tracklist: acompanhar por detecção de silêncio e rechecagens, sem progresso preciso.
- Match ambíguo: escolher o release com melhor combinação de artista, faixa e álbum; se ainda ambíguo, mostrar o candidato mais provável e permitir correção futura.

## Testes e Validação

Validação técnica:

- Sincronizar a coleção pública e confirmar contagem de releases.
- Buscar detalhes de um release conhecido e validar tracklist com posições e durações.
- Testar captura de microfone no OnePlus em HTTPS local.
- Testar envio de áudio do navegador ao Raspberry Pi.
- Testar reconhecimento com pelo menos 5 discos da coleção.
- Testar cenário de disco não cadastrado.

Validação de interface:

- Conferir legibilidade no OnePlus em paisagem.
- Conferir que textos longos não quebram a tela.
- Conferir que capa, título, artista e progresso são visíveis a distância.
- Conferir estados `listening`, `identifying`, `playing`, `side_pause` e `not_found`.
- Conferir comportamento com tela ligada por longos períodos.

## Decisões Fechadas

- Usar Raspberry Pi como servidor local.
- Começar sem microfone USB; o celular captura o áudio.
- Usar somente a coleção Discogs do usuário como catálogo.
- Se o disco não estiver na coleção, avisar o usuário para cadastrar no Discogs.
- Começar com PWA/web app em vez de app Android nativo.
- Usar interface minimalista.
- Fixar a interface do MVP em paisagem.
- Usar AudD como API inicial de reconhecimento; avaliar ACRCloud como fallback se a precisão com vinil for ruim.

## Perguntas Futuras

- Decidir se haverá correção manual de match no MVP ou em uma fase posterior.
- Decidir intervalo de sincronização automática da coleção.
- Decidir se uma versão futura deve suportar retrato além de paisagem.

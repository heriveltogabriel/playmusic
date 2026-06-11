# Vinyl Display

Tela de exibição minimalista (estilo "now playing") de disco de vinil para servidor Raspberry Pi e celulares Android/iOS.

## O Que Faz

- **Sincroniza Coleção do Discogs**: Espelhamento de catálogo local para correspondências rápidas offline.
- **Scrobble/Audição Automática**: Registra automaticamente uma audição para o disco se mais de uma faixa dele for tocada na mesma sessão de reprodução.
- **Favorito Automático**: Marca o disco automaticamente como favorito assim que ele alcançar 20 audições acumuladas.
- **Sincronização Centralizada nas Configurações**: O botão de atualizar/sincronizar coleção agora fica estrategicamente localizado no topo da aba de Configurações, removendo o botão redundante dos botões de navegação de mídia.
- **Design Retrô Bauhaus (Amber Landscape)**: Paleta AMOLED de carvão fosco, creme analógico quente e laranja ferrugem/âmbar com animação de disco de vinil girando e deslizando, otimizada para telas móveis no modo paisagem.
- **Acesso Dinâmico ao Microfone no iOS**: Inicializa o microfone e o `AudioContext` da Web Audio API de forma segura dentro de eventos de toque/clique do usuário para contornar restrições de reprodução automática e captura silenciosa do iOS Safari.
- **Reamostragem de PCM em Tempo Real**: Realiza reamostragem linear no cliente para converter as taxas nativas do dispositivo (ex. 48kHz) para PCM de 16 bits assinado mono a 44.1kHz dinamicamente para reconhecimento via Shazam Core.
- **Escuta Agendada Baseada em Tempo (Cooldown)**: Suspende a captura do microfone durante a reprodução da faixa, agendando a próxima consulta apenas próximo ao final da música atual para economizar uso de CPU e créditos de API.
- **Barra de Progresso Suave em Tempo Real**: Interpola o progresso localmente em intervalos de 250ms para animações fluidas e atualiza o tempo decorrido e total no formato `M:SS`.
- **Popups de Erro AMOLED Glassmorphism**: Captura falhas de rede, erros internos do servidor (500) e bloqueios de microfone, apresentando um diálogo de aviso personalizado em vez de falhar silenciosamente.
- **Integração PWA**: Inclui um manifesto web (`manifest.json`) que permite instalar o aplicativo como um aplicativo autônomo na tela inicial do Android/iOS.

## Configuração

Copie o arquivo `.env.example` para `.env` e preencha com as suas credenciais locais. O arquivo `.env` é ignorado pelo git para que seus segredos permaneçam locais.

Necessário para o reconhecimento (Shazam via RapidAPI):

```env
RAPIDAPI_SHAZAM_KEY=sua-chave-rapidapi
RAPIDAPI_SHAZAM_HOST=shazam-core.p.rapidapi.com
```

As variáveis de ambiente do terminal ainda têm prioridade sobre o arquivo `.env`, o que é útil para substituições temporárias.

Configurações para captura de microfone no Android/Chrome:

```bash
export VINYL_CERT_FILE="/caminho/para/cert-local.pem"
export VINYL_KEY_FILE="/caminho/para/key-local.pem"
```

A API de microfone do navegador exige um contexto seguro (HTTPS). No Raspberry Pi, execute este aplicativo via HTTPS usando um certificado local no qual o celular confie.

## Instalação Servidor Remoto Linux

Disponibilizamos um script de configuração automatizado que instala as dependências de sistema necessárias, gera certificados SSL/TLS locais autoassinados, copia os arquivos de configuração e configura um serviço `systemd` para que o aplicativo seja iniciado automaticamente quando o servidor ligar.

Para executar a instalação:

```bash
chmod +x setup.sh
./setup.sh
```

Depois de concluído, preencha suas chaves de API no arquivo `.env` gerado e reinicie o serviço:

```bash
sudo systemctl restart vinyl-display
```

## Execução Manual

Se preferir rodar o servidor manualmente sem usar o `systemd`:

```bash
python3 -m vinyl_display.server
```

Se o seu Raspberry Pi mapear `python` para o Python 3, `python -m vinyl_display.server` também funciona.

Abra o navegador em:

```text
https://<ip-ou-host-do-raspberry-pi>:8080
```

## Sincronizar Coleção

O servidor expõe o seguinte endpoint:

```text
POST /api/sync
```

De outra máquina na mesma rede:

```bash
curl -X POST https://raspberrypi.local:8080/api/sync
```

## Endpoints Úteis da API

```text
GET  /api/health
GET  /api/state
POST /api/sync
POST /api/recognize
```

## Testes

```bash
python3 -m unittest discover -v
```

# Celular do player como quiosque (Android)

Objetivo: o celular ao lado do toca-discos liga, abre o player e fica ouvindo sem ninguém tocar nele.

## Opção 1 — Chrome com o app instalado (sem instalar nada)

1. No celular, abra `https://heriveltogabriel.com.br/vinyl/` no Chrome.
2. Menu ⋮ → **Adicionar à tela inicial** → **Instalar**. O player abre em tela cheia, sem barra do navegador.
3. Abra pelo ícone novo e toque na tela uma vez para liberar o microfone (**Permitir sempre** / "Ao usar o app").
4. Em **Configurações do Android → Apps → Chrome → Bateria**, escolha **Sem restrições**, para o sistema não pausar o player.
5. Deixe o celular no carregador.

A partir da v3.7, o player tenta ligar o microfone sozinho quando a página abre e já tem permissão. Se o Chrome exigir um toque mesmo assim, você recebe o alerta "o microfone do player está pausado" no Telegram.

## Opção 2 — Fully Kiosk Browser (mais autônomo)

App gratuito na Play Store, feito para tablets e celulares de parede.

1. Instale o **Fully Kiosk Browser** e abra.
2. **Start URL**: `https://heriveltogabriel.com.br/vinyl/`
3. **Web Content Settings**: ative *Enable Microphone Access* e *Autoplay Videos/Audio*.
4. **Device Management**: ative *Keep Screen On* e *Start on Boot*.
5. **Web Auto Reload**: *Reload on Network Reconnect* ligado.
6. Na primeira abertura, aceite a permissão do microfone.

Com isso o celular abre o player sozinho depois de reiniciar ou de uma queda de energia, e o microfone liga sem toque.

## Conferir

Em **Configurações → Player e alertas** do admin aparece algo como:

> 🟢 Player online · visto há 20 s · microfone ouvindo · versão 3.7.0

Se estiver "microfone pausado", toque uma vez na tela do celular.

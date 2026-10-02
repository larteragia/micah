# Instalação por curl (Windows e Linux), 2026-10-02

Um comando por sistema operacional, do jeito que o Micah está na máquina do
Rodrigo: o pacote oficial do GitHub Release instalado, e o resto (CLI `micah`,
shell integration, WebView2, autostart, updater) o próprio app configura no
primeiro run.

## Windows (PowerShell ou cmd, o curl do Windows 10+ serve)

```
curl -fsSL https://raw.githubusercontent.com/larteragia/micah/main/scripts/install.ps1 | powershell -NoProfile -ExecutionPolicy Bypass -
```

- Instala o bundle NSIS `Micah_<versão>_x64-setup.exe` em modo silencioso,
  por usuário, sem janela de UAC.
- Smart App Control precisa estar **desligado** (Ajustes > Privacidade e
  segurança > Segurança do Windows > Controle de aplicativos e navegador);
  o instalador avisa no final.
- Variantes: `-Version v0.8.6` pina a versão, `-Msi` instala o `.msi` no lugar
  do NSIS (pode pedir elevação), `-DryRun` só resolve e imprime o que faria,
  `-Run` abre o Micah logo após instalar.

## Linux (qualquer distro com curl)

```
curl -fsSL https://raw.githubusercontent.com/larteragia/micah/main/scripts/install.sh | sh -s --
```

- `auto` (padrão): Debian/Ubuntu com apt instala o `.deb` (puxa
  webkit2gtk-4.1 e gtk3 do repositório da distro); Fedora/RHEL/openSUSE
  instalam o `.rpm`; qualquer outra coisa cai no AppImage.
- AppImage em `~/.local/bin` com launcher `micah`: sem FUSE montado o
  launcher usa `--appimage-extract-and-run`, e em Wayland exporta
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` (as duas adaptações que o README
  documentava à mão). Cria também a entrada
  `~/.local/share/applications/app.orvoton.micah.desktop`.
- Variantes: `--version v0.8.6`, `--method deb|rpm|appimage|auto`,
  `--bin-dir <dir>`, `--dry-run`.
- ARM64: ainda não existe build publicado, o script avisa e sai.

## Pré-requisito: release publicado

Os scripts leem `releases/latest` da API pública do GitHub, e **release em
draft é invisível** pra ela. Enquanto nenhum release estiver publicado o
comando falha com esse aviso; publicar o draft (ou taggear com
`releaseDraft: false` no `release.yml`) resolve na hora.

## Fontes

- `scripts/install.ps1` e `scripts/install.sh` (este repo).
- Bundles por release: `Micah_<v>_x64-setup.exe`, `Micah_<v>_x64_en-US.msi`,
  `Micah_<v>_amd64.AppImage`, `.deb` e `.rpm` (job `publish-orvoton` do
  `release.yml`, assinados por SignPath no Windows e re-assinados como
  AppImage no Linux).

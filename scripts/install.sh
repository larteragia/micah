#!/bin/sh
# One-liner installer for Micah on Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/larteragia/micah/main/scripts/install.sh | sh -s --
#
# Resolves the latest published release, picks the right bundle for the
# distro (deb on apt, rpm on dnf/yum/zypper, AppImage otherwise) and
# installs it. The app configures the rest itself on first run: CLI
# run-dir, shell integration, updates.
#
# Flags:
#   --version <tag>   install a specific tag, e.g. --version v0.8.6
#   --method <name>   force deb | rpm | appimage | auto (default auto)
#   --bin-dir <dir>   where the AppImage goes (default ~/.local/bin)
#   --dry-run         resolve and print what would happen, change nothing

set -eu

REPO="larteragia/micah"
API_BASE="https://api.github.com/repos/$REPO"
VERSION=""
METHOD="auto"
BIN_DIR="$HOME/.local/bin"
DRY_RUN=0

die() {
  echo "micah install: $1" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version|-v) VERSION="${2:-}"; [ -n "$VERSION" ] || die "--version needs a tag, e.g. v0.8.6"; shift 2 ;;
    --method|-m) METHOD="${2:-}"; shift 2 ;;
    --bin-dir) BIN_DIR="${2:-}"; [ -n "$BIN_DIR" ] || die "--bin-dir needs a path"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --help|-h)
      cat <<'USAGE'
usage: install.sh [--version <tag>] [--method deb|rpm|appimage|auto]
                  [--bin-dir <dir>] [--dry-run]

Installs the latest published Micah release for Linux:
  deb       via apt-get (auto-detected on Debian/Ubuntu)
  rpm       via dnf/yum/zypper (auto-detected on Fedora/RHEL/openSUSE)
  appimage  self-contained file under --bin-dir with a `micah` launcher
USAGE
      exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

case "$(uname -s)" in
  Linux*) ;;
  *) die "this script installs the Linux build; on Windows use scripts/install.ps1" ;;
esac

case "$(uname -m)" in
  x86_64) ;;
  aarch64|arm64) die "no aarch64 build is published yet, only x86_64. Watch $REPO releases." ;;
  *) die "unsupported architecture: $(uname -m)" ;;
esac

# ---- resolve the release ----------------------------------------------------

if ! command -v curl >/dev/null 2>&1; then
  die "curl is required (that is the whole point of this script)"
fi

if [ -n "$VERSION" ]; then
  RELEASE_URL="$API_BASE/releases/tags/$VERSION"
else
  RELEASE_URL="$API_BASE/releases/latest"
fi

# Draft releases are invisible to the unauthenticated API, so a 404 on
# "latest" almost always means "nothing published yet" rather than "no tags".
RELEASE_JSON=$(curl -fsSL "$RELEASE_URL" 2>/dev/null) || {
  if [ -n "$VERSION" ]; then
    die "release $VERSION not found in $REPO"
  else
    die "no published release in $REPO yet. Drafts are invisible to installers: publish one at https://github.com/$REPO/releases and run this again."
  fi
}

TAG=$(printf '%s' "$RELEASE_JSON" | grep -o '"tag_name": *"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$TAG" ] || die "could not parse tag_name from the GitHub API response"

asset_urls() {
  printf '%s' "$RELEASE_JSON" \
    | grep -o '"browser_download_url": *"[^"]*"' \
    | cut -d'"' -f4
}

pick_asset() {
  asset_urls | grep -E "$1" | head -1
}

DEB_URL=$(pick_asset '_amd64\.deb$')
RPM_URL=$(pick_asset '\.rpm$')
APPIMAGE_URL=$(pick_asset '_amd64\.AppImage$')

# ---- pick the method --------------------------------------------------------

if [ "$METHOD" = "auto" ]; then
  if command -v apt-get >/dev/null 2>&1 && [ -n "$DEB_URL" ]; then
    METHOD=deb
  elif command -v dnf >/dev/null 2>&1 && [ -n "$RPM_URL" ]; then
    METHOD=rpm
  elif command -v yum >/dev/null 2>&1 && [ -n "$RPM_URL" ]; then
    METHOD=rpm
  elif command -v zypper >/dev/null 2>&1 && [ -n "$RPM_URL" ]; then
    METHOD=rpm
  elif [ -n "$APPIMAGE_URL" ]; then
    METHOD=appimage
  else
    die "no installable asset in $TAG (need _amd64.deb, .rpm or _amd64.AppImage). Assets: $(asset_urls | tr '\n' ' ')"
  fi
fi

case "$METHOD" in
  deb) URL="$DEB_URL" ;;
  rpm) URL="$RPM_URL" ;;
  appimage) URL="$APPIMAGE_URL" ;;
  *) die "unknown method: $METHOD (use deb, rpm, appimage or auto)" ;;
esac
[ -n "$URL" ] || die "release $TAG has no bundle for method $METHOD"

FILE=$(basename "$URL")

echo "Micah $TAG"
echo "method  : $METHOD"
echo "bundle  : $FILE"
echo "download: $URL"

if [ "$DRY_RUN" = "1" ]; then
  echo "dry run : nothing downloaded, nothing installed"
  exit 0
fi

# ---- download and sanity-check ----------------------------------------------

if [ "$METHOD" = "appimage" ]; then
  mkdir -p "$BIN_DIR"
  DEST="$BIN_DIR/$FILE"
else
  DEST="/tmp/$FILE"
fi

echo "downloading to $DEST ..."
curl -fSL --retry 3 -o "$DEST" "$URL"

# An AppImage is an ELF executable; guards against an HTML error page saved
# with the right name.
MAGIC=$(head -c 4 "$DEST" | od -An -tx1 | tr -d ' \n')
[ "$MAGIC" = "7f454c46" ] || die "$DEST is not a Linux executable (bad magic bytes), the download was corrupted"

SIZE=$(wc -c < "$DEST")
[ "$SIZE" -gt 5000000 ] || die "$DEST is only $SIZE bytes, that is not a real bundle"

# ---- install ----------------------------------------------------------------

SUDO=""
[ "$(id -u)" = "0" ] || SUDO="sudo"

case "$METHOD" in
  deb)
    # apt resolves webkit2gtk-4.1 and gtk3 from the distro on its own.
    $SUDO apt-get install -y "$DEST"
    ;;
  rpm)
    if command -v dnf >/dev/null 2>&1; then
      $SUDO dnf install -y "$DEST"
    elif command -v yum >/dev/null 2>&1; then
      $SUDO yum localinstall -y "$DEST"
    else
      $SUDO zypper --non-interactive install "$DEST"
    fi
    ;;
  appimage)
    chmod 755 "$DEST"

    # Adaptations the README documents by hand: no FUSE mounted means the
    # AppImage must extract itself, and WebKit needs DMABUF off on Wayland.
    NEED_EXTRACT=0
    command -v fusermount >/dev/null 2>&1 || command -v fusermount3 >/dev/null 2>&1 || NEED_EXTRACT=1
    NEED_WEBKIT_ENV=0
    [ "${XDG_SESSION_TYPE:-}" = "wayland" ] && NEED_WEBKIT_ENV=1
    [ -n "${WAYLAND_DISPLAY:-}" ] && NEED_WEBKIT_ENV=1

    WRAPPER="$BIN_DIR/micah"
    {
      echo '#!/bin/sh'
      [ "$NEED_WEBKIT_ENV" = "1" ] && echo 'export WEBKIT_DISABLE_DMABUF_RENDERER=1'
      if [ "$NEED_EXTRACT" = "1" ]; then
        printf 'exec "%s" --appimage-extract-and-run "$@"\n' "$DEST"
      else
        printf 'exec "%s" "$@"\n' "$DEST"
      fi
    } > "$WRAPPER"
    chmod 755 "$WRAPPER"
    echo "launcher: $WRAPPER"

    DESKTOP_DIR="$HOME/.local/share/applications"
    mkdir -p "$DESKTOP_DIR"
    {
      echo '[Desktop Entry]'
      echo 'Type=Application'
      echo 'Name=Micah'
      echo "Exec=$WRAPPER"
      echo "Icon=$DEST"
      echo 'Categories=TerminalEmulator;Development;'
      echo 'StartupWMClass=Micah'
    } > "$DESKTOP_DIR/app.orvoton.micah.desktop"
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" || true
    echo "desktop : $DESKTOP_DIR/app.orvoton.micah.desktop"
    ;;
esac

echo ""
echo "Micah $TAG installed. Launch it from your app menu (or run: $BIN_DIR/micah)."
echo "The CLI, shell integration and updates configure themselves on first run."

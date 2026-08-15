# micah-shell-integration (bashrc)
#
# Differences vs zsh integration:
# - We emulate login-shell init manually (/etc/profile, profile files) because
#   bash ignores --rcfile when started with -l.
# - Pre-exec marker uses PS0 (bash 4.4+). On older bash (macOS default 3.2) we
#   skip it — a fragile DEBUG-trap alternative would clobber the user's own
#   traps and interact badly with debuggers.

if [ -z "$__MICAH_HOOKS_LOADED" ]; then
  __MICAH_HOOKS_LOADED=1

  [ -f /etc/profile ] && source /etc/profile
  [ -f /etc/bashrc ] && source /etc/bashrc
  if [ -f "$HOME/.bash_profile" ]; then
    source "$HOME/.bash_profile"
  elif [ -f "$HOME/.bash_login" ]; then
    source "$HOME/.bash_login"
  elif [ -f "$HOME/.profile" ]; then
    source "$HOME/.profile"
  fi
  # .bashrc may have been sourced already by .bash_profile; sourcing again is
  # safe for idempotent rc files (the common case). If yours has side effects
  # on reload, guard with a flag.
  [ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"

  if [ -n "$MICAH_CLI" ] && [ -x "$MICAH_CLI" ]; then
    micah() {
      command "$MICAH_CLI" "$@"
    }
  fi

  # Claude Code wrapper: every launch is born with a session id generated
  # here, announced to the host via an OSC 777 `session` marker so the tab can
  # resume the same conversation after a restart. Flags and subcommands with
  # their own session semantics pass through untouched (a typed --resume or
  # --session-id id is re-anchored, never rewritten).
  claude() {
    local exe
    exe="$(type -P claude 2>/dev/null)"
    if [ -z "$exe" ]; then
      echo "claude: nao encontrado no PATH" >&2
      return 127
    fi
    local uuid_re='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    local passthrough='' fork='' anchor='' await_id='' arg
    for arg in "$@"; do
      if [ -n "$await_id" ]; then
        [[ "$arg" =~ $uuid_re ]] && anchor="$(printf '%s' "$arg" | tr '[:upper:]' '[:lower:]')"
        await_id=''
      fi
      case "$arg" in
        --resume|-r|--session-id) passthrough=1; await_id=1 ;;
        --continue|-c|-p|--print|--version|-v|--help|-h) passthrough=1 ;;
        --fork-session) passthrough=1; fork=1 ;;
        -*) ;;
        mcp|agents|doctor|plugin|install|update|auth|project|setup-token|import|gateway|auto-mode|ultrareview) passthrough=1 ;;
      esac
    done
    if [ -n "$passthrough" ]; then
      # A forked session gets a fresh id chosen by the CLI: unknowable here.
      if [ -n "$anchor" ] && [ -z "$fork" ]; then
        printf '\e]777;notify;Micah;claude;session;%s\e\\' "$anchor"
      fi
      "$exe" "$@"
      return
    fi
    local sid=''
    if command -v uuidgen >/dev/null 2>&1; then
      sid="$(command uuidgen 2>/dev/null | tr '[:upper:]' '[:lower:]')"
    elif [ -r /proc/sys/kernel/random/uuid ]; then
      sid="$(cat /proc/sys/kernel/random/uuid)"
    fi
    if ! [[ "$sid" =~ $uuid_re ]]; then
      "$exe" "$@"
      return
    fi
    printf '\e]777;notify;Micah;claude;session;%s\e\\' "$sid"
    "$exe" --session-id "$sid" "$@"
  }

  _micah_urlencode() {
    local LC_ALL=C s="$1" i c
    for (( i=0; i<${#s}; i++ )); do
      c="${s:i:1}"
      case "$c" in
        [a-zA-Z0-9/._~-]) printf '%s' "$c" ;;
        *) printf '%%%02X' "'$c" ;;
      esac
    done
  }

  _micah_precmd() {
    local _micah_ret=$?
    printf '\e]133;D;%s\e\\' "$_micah_ret"
    printf '\e]7;file://%s%s\e\\' "${HOSTNAME:-$(uname -n 2>/dev/null)}" "$(_micah_urlencode "$PWD")"
    if [ -n "$MICAH_BLOCKS" ]; then
      # Host renders its own input bar: suppress the shell prompt (B marker
      # only) and reserve header/gap rows, mirroring the zsh integration.
      if [ -n "$_micah_block_seen" ]; then
        PS1='\n\n\[\e]133;B\e\\\]'
      else
        PS1='\n\[\e]133;B\e\\\]'
      fi
    elif [ -z "$__MICAH_PS1_INJECTED" ]; then
      PS1='\[\e]133;B\e\\\]'"$PS1"
      __MICAH_PS1_INJECTED=1
    fi
    printf '\e]133;A\e\\'
  }

  case ":${PROMPT_COMMAND:-}:" in
    *":_micah_precmd:"*) ;;
    *) PROMPT_COMMAND="_micah_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
  esac

  # Pre-exec marker via PS0 (bash 4.4+). PS0 is expanded just before a command
  # runs — cleaner than a DEBUG trap, which would clobber user traps and fire
  # on every command including inside PROMPT_COMMAND.
  if [ "${BASH_VERSINFO[0]:-0}" -gt 4 ] \
     || { [ "${BASH_VERSINFO[0]:-0}" -eq 4 ] && [ "${BASH_VERSINFO[1]:-0}" -ge 4 ]; }; then
    if [ -n "$MICAH_BLOCKS" ]; then
      # PS0 only expands, never executes: the arithmetic inside the array
      # subscript sets the seen flag while the unset array expands to nothing.
      PS0='\[\e]133;C\e\\\]${_micah_noop[$((_micah_block_seen=1))]}'"${PS0:-}"
    else
      PS0='\[\e]133;C\e\\\]'"${PS0:-}"
    fi
  fi

  _micah_precmd
fi
:

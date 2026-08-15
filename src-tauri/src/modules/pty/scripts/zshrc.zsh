# micah-shell-integration (zshrc)
#
# Emits OSC 7 (cwd) + OSC 133 A/B/C/D (prompt-start / prompt-end / pre-exec /
# command-done-with-exit-code) so the host can detect command boundaries and
# track cwd without re-parsing the prompt. `status` is a read-only special in
# zsh, so we shadow $? into `_micah_ret`.

{
  _micah_user_zdotdir="${MICAH_USER_ZDOTDIR:-$HOME}"
  [ -f "$_micah_user_zdotdir/.zshrc" ] && source "$_micah_user_zdotdir/.zshrc"
  unset _micah_user_zdotdir
}

if [[ -n "$MICAH_CLI" && -x "$MICAH_CLI" ]]; then
  micah() {
    command "$MICAH_CLI" "$@"
  }
fi

# Claude Code wrapper: every launch is born with a session id generated here,
# announced to the host via an OSC 777 `session` marker so the tab can resume
# the same conversation after a restart. Flags and subcommands with their own
# session semantics pass through untouched (a typed --resume or --session-id
# id is re-anchored, never rewritten).
claude() {
  local exe
  exe="$(whence -p claude 2>/dev/null)"
  if [[ -z "$exe" ]]; then
    print -u2 "claude: nao encontrado no PATH"
    return 127
  fi
  local uuid_re='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  local passthrough='' fork='' anchor='' await_id='' arg
  for arg in "$@"; do
    if [[ -n "$await_id" ]]; then
      [[ "$arg" =~ $uuid_re ]] && anchor="${arg:l}"
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
  if [[ -n "$passthrough" ]]; then
    # A forked session gets a fresh id chosen by the CLI: unknowable here.
    if [[ -n "$anchor" && -z "$fork" ]]; then
      printf '\e]777;notify;Micah;claude;session;%s\e\\' "$anchor"
    fi
    "$exe" "$@"
    return
  fi
  local sid=''
  if command -v uuidgen >/dev/null 2>&1; then
    sid="$(command uuidgen 2>/dev/null)"
    sid="${sid:l}"
  elif [[ -r /proc/sys/kernel/random/uuid ]]; then
    sid="$(</proc/sys/kernel/random/uuid)"
  fi
  if [[ ! "$sid" =~ $uuid_re ]]; then
    "$exe" "$@"
    return
  fi
  printf '\e]777;notify;Micah;claude;session;%s\e\\' "$sid"
  "$exe" --session-id "$sid" "$@"
}

# Re-source guard within a single shell (e.g. user runs `source ~/.zshrc`).
# This is NOT exported, so each nested zsh installs its own hooks — desired,
# since every interactive shell needs its own prompt integration.
if [[ -z "$__MICAH_HOOKS_LOADED" ]]; then
  __MICAH_HOOKS_LOADED=1
  autoload -Uz add-zsh-hook 2>/dev/null

  # URL-encode $PWD byte-wise so multi-byte paths stay valid in the `file://`
  # URI emitted via OSC 7. `no_multibyte` forces ${s[i]} to index bytes (not
  # code points), and LC_ALL=C keeps the [a-zA-Z0-9...] class single-byte.
  _micah_urlencode() {
    emulate -L zsh
    setopt localoptions no_multibyte
    local LC_ALL=C s="$1" i byte
    for (( i=1; i<=${#s}; i++ )); do
      byte="${s[i]}"
      case "$byte" in
        [a-zA-Z0-9/._~-]) printf '%s' "$byte" ;;
        *) printf '%%%02X' "'$byte" ;;
      esac
    done
  }

  _micah_precmd() {
    local _micah_ret=$?
    printf '\e]133;D;%s\e\\' "$_micah_ret"
    printf '\e]7;file://%s%s\e\\' "${HOST}" "$(_micah_urlencode "$PWD")"
    # In block mode the host renders its own input bar, so suppress the shell
    # prompt entirely (keep only the OSC 133 B marker) and add a leading blank
    # line so frozen command blocks get vertical breathing room.
    if [[ -n "$MICAH_BLOCKS" ]]; then
      # Spacing reserved for the host-drawn block header lives in the prompt
      # (the grid is WebGL, not CSS). Later prompts get two blank rows: the
      # upper one is the previous block's end gap (above its divider), the lower
      # one is this command's header row. The very first prompt has no block
      # above it, so it gets a single row (header only) to avoid a tall top gap.
      if [[ -n "$_micah_block_seen" ]]; then
        PS1=$'\n\n%{\e]133;B\e\\%}'
      else
        PS1=$'\n%{\e]133;B\e\\%}'
      fi
      RPROMPT=''
    elif [[ "$PS1" != *$'\e]133;B\e\\'* ]]; then
      # Re-inject prompt-end marker in case a framework rebuilt PS1 (p10k, starship).
      PS1=$'%{\e]133;B\e\\%}'"$PS1"
    fi
    printf '\e]133;A\e\\'
  }

  _micah_preexec() {
    # Mark that a real command ran, so the next prompt switches from one blank
    # row (first prompt, no block above) to two (end gap + header row).
    [[ -n "$MICAH_BLOCKS" ]] && _micah_block_seen=1
    local cmd="${1//[[:cntrl:]]/ }"
    printf '\e]133;C;%s\e\\' "${cmd[1,256]}"
  }

  if (( $+functions[add-zsh-hook] )); then
    add-zsh-hook precmd _micah_precmd
    add-zsh-hook preexec _micah_preexec
  fi

  # Warp/iTerm2-style word-end navigation: zsh's default `forward-word` (M-f /
  # Option+Right) overshoots to the START of the next word; `emacs-forward-word`
  # stops at the END of the current word, which is what nearly every other shell
  # and GUI editor does. Only rebind when the binding is still the stock zsh
  # default — respects any explicit remap in the user's .zshrc.
  if (( $+widgets[emacs-forward-word] )) \
     && [[ "$(bindkey '\ef')" == '"^[f" forward-word' ]]; then
    bindkey '\ef' emacs-forward-word
  fi

  _micah_precmd
fi
:

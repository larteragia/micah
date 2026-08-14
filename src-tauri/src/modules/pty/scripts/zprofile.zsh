# micah-shell-integration (zprofile)
#
# See zshenv.zsh for the rationale on the trailing `:`.
{
  _micah_user_zdotdir="${MICAH_USER_ZDOTDIR:-$HOME}"
  [ -f "$_micah_user_zdotdir/.zprofile" ] && source "$_micah_user_zdotdir/.zprofile"
  unset _micah_user_zdotdir
}
:

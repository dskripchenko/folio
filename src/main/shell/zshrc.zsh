
# folio: the commands marked (OSC 133, 633;E) and the folder said (OSC 7).
autoload -Uz add-zsh-hook
typeset -g __folio_ran=
__folio_precmd() {
  local ret=$?
  if [[ -n $__folio_ran ]]; then
    printf '\e]133;D;%s\a' "$ret"
    __folio_ran=
  fi
  printf '\e]7;file://%s%s\a' "${HOST}" "${PWD// /%20}"
  printf '\e]133;A\a'
  [[ $PS1 == *'133;B'* ]] || PS1="$PS1%{"$'\e]133;B\a'"%}"
}
__folio_preexec() {
  __folio_ran=1
  local cmd=${1//\\/\\\\}
  cmd=${cmd//;/\\x3b}
  cmd=${cmd//$'\n'/\\x0a}
  printf '\e]633;E;%s\a' "$cmd"
  printf '\e]133;C\a'
}
add-zsh-hook precmd __folio_precmd
add-zsh-hook preexec __folio_preexec
# From here on zsh reads the user's own files (.zlogin) from the user's folder.
ZDOTDIR=${FOLIO_USER_ZDOTDIR}
unset FOLIO_USER_ZDOTDIR FOLIO_ZDOTDIR

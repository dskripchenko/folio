# folio: started in place of ~/.bashrc; first what a login shell reads.
[ -f /etc/profile ] && . /etc/profile
__folio_profile=
for __folio_f in ~/.bash_profile ~/.bash_login ~/.profile; do
  if [ -f "$__folio_f" ]; then . "$__folio_f"; __folio_profile=1; break; fi
done
[ -z "$__folio_profile" ] && [ -f ~/.bashrc ] && . ~/.bashrc
unset __folio_f __folio_profile

# The commands marked (OSC 133, 633;E) and the folder said (OSC 7).
__folio_ran=
__folio_in_prompt=
__folio_prompt() {
  if [ -n "$__folio_ran" ]; then
    printf '\e]133;D;%s\a' "$__folio_ret"
    __folio_ran=
  fi
  printf '\e]7;file://%s%s\a' "$HOSTNAME" "${PWD// /%20}"
  printf '\e]133;A\a'
}
__folio_mark_input() {
  case "$PS1" in *'133;B'*) ;; *) PS1="$PS1"'\[\e]133;B\a\]' ;; esac
}
__folio_preexec() {
  [ -n "$COMP_LINE" ] && return
  [ -n "$__folio_in_prompt" ] && return
  case "$BASH_COMMAND" in __folio_*) return ;; esac
  [ -n "$__folio_ran" ] && return
  __folio_ran=1
  local cmd
  cmd=$(HISTTIMEFORMAT= history 1 | sed 's/^ *[0-9]* *//')
  # History off (some profiles turn it off) or not kept yet: the command being run.
  [ -z "$cmd" ] && cmd=$BASH_COMMAND
  cmd=${cmd//\\/\\\\}
  cmd=${cmd//;/\\x3b}
  printf '\e]633;E;%s\a' "$cmd"
  printf '\e]133;C\a'
}
# PROMPT_COMMAND may be an array (bash 5.1+; systemd's profile adds to it on Ubuntu 26.04): every
# part of it runs inside folio's, so none is taken for a command typed.
__folio_pc=
for __folio_c in "${PROMPT_COMMAND[@]}"; do [ -n "$__folio_c" ] && __folio_pc="$__folio_pc$__folio_c; "; done
unset PROMPT_COMMAND
PROMPT_COMMAND="__folio_ret=\$?; __folio_in_prompt=1; __folio_prompt; ${__folio_pc}__folio_mark_input; __folio_in_prompt="
unset __folio_c __folio_pc
# Last: set before, the trap would take the lines above for commands typed.
trap '__folio_preexec' DEBUG

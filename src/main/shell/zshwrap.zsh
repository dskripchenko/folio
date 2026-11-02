# folio: the user's own __FILE__ first.
if [[ -f "${FOLIO_USER_ZDOTDIR}/__FILE__" ]]; then
  FOLIO_ZDOTDIR=${ZDOTDIR}
  ZDOTDIR=${FOLIO_USER_ZDOTDIR}
  . "${FOLIO_USER_ZDOTDIR}/__FILE__"
  # It may have moved ZDOTDIR itself: the next files are read from there.
  FOLIO_USER_ZDOTDIR=${ZDOTDIR}
  ZDOTDIR=${FOLIO_ZDOTDIR}
fi

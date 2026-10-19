# Sourced by every play.sh: run scripts and shells from before the rename still export AOA_*.
# Each AOA_X becomes CASTELLAN_X unless CASTELLAN_X is already set.
for name in $(env | sed -n 's/^\(AOA_[A-Za-z0-9_]*\)=.*/\1/p'); do
  new="CASTELLAN_${name#AOA_}"
  eval "[ -n \"\${$new+x}\" ] || export $new=\"\$$name\""
done

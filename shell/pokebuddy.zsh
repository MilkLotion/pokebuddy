# git clone 으로 설치했을 때 pokebuddy 를 PATH 에 올린다. ~/.zshrc 에서 이 파일을 source 한다.
# npm 으로 설치했으면 필요 없다.
#
#   pokebuddy companion                        동반자 띄우기 (pokebuddy companion stop 으로 내린다)

_pokebuddy_bin="${${(%):-%x}:A:h:h}/bin"
[[ ":$PATH:" == *":$_pokebuddy_bin:"* ]] || export PATH="$_pokebuddy_bin:$PATH"
unset _pokebuddy_bin

#zmodload zsh/zprof

export ZSH=$HOME/.oh-my-zsh
ZSH_THEME="agnoster"
plugins=(git zsh-autosuggestions)

source $ZSH/oh-my-zsh.sh

export PATH=/opt/local/bin:/opt/local/sbin:$PATH
export PATH=$PATH:/usr/local/go/bin

[ -d /usr/bin/go ] && {
  export GOROOT=/usr/bin/go
} || [ -d /usr/local/go  ] && {
  export GOROOT=/usr/local/go
} || [ -d /usr/lib/go  ] && {
  export GOROOT=/usr/lib/go
}

export GOPATH=$HOME/go
export VIMRC=$HOME/.config/nvim/init.vim
export SYSTEMD_EDITOR="$(which nvim > /dev/null  && echo nvim || echo vim)"

export PATH=$GOPATH/bin:$GOROOT/bin:$PATH
export PATH=$HOME/.local/bin:$PATH
export PATH=$HOME/.bin/:$PATH
export PATH=$HOME/.node/bin:$PATH
export NODE_PATH="$HOME/.node/lib/node_modules:$NODE_PATH"

#No more display problem
export QT_AUTO_SCREEN_SCALE_FACTOR=1
export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8

#Color in ip command
alias ip="ip -c "

export EDITOR=nvim
export VISUAL=nvim
export BROWSER=firefox

[ -e ~/.shell_functions ] && . ~/.shell_functions
[ -e ~/.shell_local  ] && . ~/.shell_local
[ -e ~/.z.sh ] && . ~/.z.sh

#Color in man
export LESS_TERMCAP_mb=$'\e[1;32m'
export LESS_TERMCAP_md=$'\e[1;32m'
export LESS_TERMCAP_me=$'\e[0m'
export LESS_TERMCAP_se=$'\e[0m'
export LESS_TERMCAP_so=$'\e[01;33m'
export LESS_TERMCAP_ue=$'\e[0m'
export LESS_TERMCAP_us=$'\e[1;4;31m'

#Fuzzy password-store
fpass () {pass $@ "$(find $HOME/.password-store -iname '*.gpg' | sed -e 's/.*password-store\///g' | sed -e 's/\.gpg$//g'| fzf)"}

alias ccal="cal -n 6 -S -m"

oo () { cd $1;ls; }

transfer() { if [ $# -eq 0 ]; then echo -e "No arguments specified. Usage:\necho transfer /tmp/test.md\ncat /tmp/test.md | transfer test.md"; return 1; fi
    tmpfile=$( mktemp -t transferXXX ); if tty -s; then basefile=$(basename "$1" | sed -e 's/[^a-zA-Z0-9._-]/-/g'); curl --progress-bar --upload-file "$1" "https://transfer.sh/$basefile" >> $tmpfile; else curl --progress-bar --upload-file "-" "https://transfer.sh/$1" >> $tmpfile ; fi; cat $tmpfile; rm -f $tmpfile; }

#Vim mode
bindkey -v
bindkey -M viins 'jk' vi-cmd-mode

# Use vim cli mode
bindkey '^P' up-history
bindkey '^N' down-history

which fzf > /dev/null && source $HOME/.fzf/key-bindings.zsh || bindkey '^r' history-incremental-search-backward

scalehidpi() {
	export GDK_SCALE=2
	export GDK_DPI_SCALE=0.95
	export QT_SCREEN_SCALE_FACTORS=0.9
	export QT_AUTO_SCREEN_SCALE_FACTOR=2
	export QT_SCALE_FACTOR=2
}

alias update_arch_mirrors="curl -s 'https://archlinux.org/mirrorlist/?country=FR&country=GB&protocol=https&use_mirror_status=on' | sed -e 's/^#Server/Server/' -e '/^#/d' | rankmirrors -n 5 - | sudo tee  /etc/pacman.d/mirrorlist"

#zprof

export PATH="$PATH:/home/raph/.foundry/bin"

export PATH="$PATH:/home/raph/.bifrost/bin"

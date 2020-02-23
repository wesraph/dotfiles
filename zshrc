# If you come from bash you might have to change your $PATH.
# export PATH=$HOME/bin:/usr/local/bin:$PATH

# Path to your oh-my-zsh installation.
export ZSH=$HOME/.oh-my-zsh

# Set name of the theme to load. Optionally, if you set this to "random"
# it'll load a random theme each time that oh-my-zsh is loaded.
# See https://github.com/robbyrussell/oh-my-zsh/wiki/Themes
ZSH_THEME="agnoster"

# Uncomment the following line to use case-sensitive completion.
# CASE_SENSITIVE="true"

# Uncomment the following line to use hyphen-insensitive completion. Case
# sensitive completion must be off. _ and - will be interchangeable.
# HYPHEN_INSENSITIVE="true"

# Uncomment the following line to disable bi-weekly auto-update checks.
# DISABLE_AUTO_UPDATE="true"

# Uncomment the following line to change how often to auto-update (in days).
# export UPDATE_ZSH_DAYS=13

# Uncomment the following line to disable colors in ls.
# DISABLE_LS_COLORS="true"

# Uncomment the following line to disable auto-setting terminal title.
# DISABLE_AUTO_TITLE="true"

# Uncomment the following line to enable command auto-correction.
# ENABLE_CORRECTION="true"

# Uncomment the following line to display red dots whilst waiting for completion.
# COMPLETION_WAITING_DOTS="true"

# Uncomment the following line if you want to disable marking untracked files
# under VCS as dirty. This makes repository status check for large repositories
# much, much faster.
# DISABLE_UNTRACKED_FILES_DIRTY="true"

# Uncomment the following line if you want to change the command execution time
# stamp shown in the history command output.
# The optional three formats: "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
# HIST_STAMPS="mm/dd/yyyy"

# Would you like to use another custom folder than $ZSH/custom?
# ZSH_CUSTOM=/path/to/new-custom-folder

# Which plugins would you like to load? (plugins can be found in ~/.oh-my-zsh/plugins/*)
# Custom plugins may be added to ~/.oh-my-zsh/custom/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
plugins=(git zsh-autosuggestions)

source $ZSH/oh-my-zsh.sh

export PATH=/opt/local/bin:/opt/local/sbin:$PATH

export PATH=$PATH:/usr/local/go/bin

[ -d /usr/bin/go ] && {
  export GOROOT=/usr/bin/go
}
[ -d /usr/local/go  ] && {
  export GOROOT=/usr/local/go
}
[ -d /usr/lib/go  ] && {
  export GOROOT=/usr/lib/go
}

export GOPATH=$HOME/go
export PATH=$GOPATH/bin:$GOROOT/bin:$PATH

export PATH=$HOME/.local/bin:$PATH
export PATH=$HOME/.bin/:$PATH

export VIMRC=$HOME/.config/nvim/init.vim

#No more display problem
export QT_AUTO_SCREEN_SCALE_FACTOR=1
export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8

#Color in ip command
alias ip="ip -c "

export EDITOR=nvim

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
fpass () {  pass $@ "$(find $HOME/.password-store -iname '*.gpg' | sed -e 's/.*password-store\///g' | sed -e 's/\.gpg$//g'| fzf)"}

alias ccal="cal -3 -m"

oo () { cd $1;ls; }

alias dailySnapshot="sudo btrfs subvolume snapshot -r / /snapshots/$(date "+%Y-%m-%d-%H-%M")"

transfer() { if [ $# -eq 0 ]; then echo -e "No arguments specified. Usage:\necho transfer /tmp/test.md\ncat /tmp/test.md | transfer test.md"; return 1; fi
    tmpfile=$( mktemp -t transferXXX ); if tty -s; then basefile=$(basename "$1" | sed -e 's/[^a-zA-Z0-9._-]/-/g'); curl --progress-bar --upload-file "$1" "https://transfer.sh/$basefile" >> $tmpfile; else curl --progress-bar --upload-file "-" "https://transfer.sh/$1" >> $tmpfile ; fi; cat $tmpfile; rm -f $tmpfile; }

#Vim mode
bindkey -v
bindkey -M viins 'jk' vi-cmd-mode

# ctrl-r starts searching history backward
bindkey '^r' history-incremental-search-backward

# Use vim cli mode
bindkey '^P' up-history
bindkey '^N' down-history

" Remap the leader key 

let mapleader = ','
set tabstop=4     " a tab is four spaces
set backspace=indent,eol,start
                    " allow backspacing over everything in insert mode
set autoindent    " always set autoindenting on
set copyindent    " copy the previous indentation on autoindenting
set number        " always show line numbers
set shiftwidth=4  " number of spaces to use for autoindenting
set shiftround    " use multiple of shiftwidth when indenting with '<' and '>'
set showmatch     " set show matching parenthesis
set ignorecase    " ignore case when searching
set smartcase     " ignore case if search pattern is all lowercase,
                    "    case-sensitive otherwise
set hlsearch      " highlight search terms
set incsearch     " show search matches as you type

if &t_Co > 2 || has("gui_running")
    " switch syntax highlighting on, when the terminal has colors
    syntax on
endif

call plug#begin('~/.config/nvim/plugged')
Plug 'vim-airline/vim-airline'
Plug 'scrooloose/nerdcommenter'
Plug 'airblade/vim-gitgutter'
Plug 'junegunn/vim-easy-align'
if has('nvim')
  Plug 'Shougo/deoplete.nvim', { 'do': ':UpdateRemotePlugins' }
endif
call plug#end()

let g:deoplete#enable_at_startup = 1

" No mouse
set mouse=

filetype plugin indent on
syntax on
colorscheme onedark

" History
set history=1000    " much more history than base
set undolevels=1000 " much more undo
" Backups, swap and undo files
"set backup                                      " Enable backups
"set backupdir=$HOME/.config/nvim/files/backup/
"set backupext=-vimbackup                        " Backup extention
"set backupskip=                                 " Backup everything
"set directory=$HOME/.config/nvim/files/swap/
"set undofile                                    " Keep the undo history
"set undodir=$HOME/.config/nvim/files/undo/

" Don't try to highlight lines longer than 800 characters.
set synmaxcol=800


" Indentation
set expandtab       "Tabs to spaces
set smarttab
set softtabstop=4
set linebreak
set autoindent

" Menu completion
set wildmenu

" Better indent
vmap > >gv
vmap < <gv

" Set encoding
"set encoding=utf-8 nobomb

" Highlight trailing spaces
highlight ExtraWhitespace term=reverse ctermbg=12
au BufNewFile,BufRead * :match ExtraWhitespace /\s\+$/


" Show all kinds of stuff
set ruler           " Show the cursor position
set shortmess=atI   " Don’t show the intro message when starting Vim
set showmode        " Show the current mode
set title           " Show the filename in the window titlebar
set showcmd         " Show the (partial) command as it’s being typed
set lazyredraw      " redraw only when we need to


" Spelling colors
hi clear SpellBad
hi SpellBad cterm=italic,bold,underline ctermfg=208
hi clear SpellCap
hi SpellCap cterm=italic ctermfg=208
hi clear SpellRare
hi SpellRare ctermfg=200

" Don’t add empty newlines at the end of files
set noeol

" jk or kj to quit insert mode
imap jk <Esc>

" Moves between splits the easy way
map <C-h> <C-w>h
map <C-j> <C-w>j
map <C-k> <C-w>k
map <C-l> <C-w>l

" More natural splits
set splitright
set splitbelow
set diffopt+=vertical

" Navigate through tabs / buffers
nnoremap gl    :tabnext<CR>
nnoremap gh    :tabprev<CR>
nnoremap gL    :bnext<CR>
nnoremap gH    :bprev<CR>


" Insert mode paste toggle
set pastetoggle=<F9>
nnoremap <F10> :set nonumber!<CR>
nnoremap <F12> :set paste<CR>i
nnoremap <leader>i :set paste<CR>i

" Open a new tab the easy way
nnoremap <leader>t :tabedit<Space>

" Use arrows for resizing windows
map <Left>  <C-W><
map <Right> <C-W>>
map <Up>    <C-W>+
map <Down>  <C-W>-

" autocmd filetype group
augroup filetype_set
    " Clear the autocmd
    autocmd!
    " Markdown filetype
    autocmd BufRead,BufNewFile *.md set filetype=markdown
    " Vagrantfile
    autocmd BufRead,BufNewFile Vagrantfile set filetype=ruby
    " JSON
    autocmd BufRead,BufNewFile *.json set filetype=json syntax=javascript
augroup END

" autocmd paste mode
augroup paste_helper
    " Clear the autocmd
    autocmd!
    " set not paste in normal mode
    autocmd InsertLeave * set nopaste
augroup END

" autocmd spell group
augroup spell_set
    " Clear the autocmd
    autocmd!
    " svn
    autocmd BufNewFile,BufRead svn-commit.tmp setlocal spell
augroup END

	" autocmd vim help
augroup vim_help
    " Clear the autocmd
    autocmd!
    " open vim help in a right split
    au BufWinEnter *.txt if &ft == 'help' | wincmd L | endif
augroup END


" autocmd location list
augroup locationlist
    autocmd!
    autocmd QuickFixCmdPost *grep* cwindow
augroup END

" Syntastic for javascript 
let g:syntastic_javascript_checkers = ['jshint']
let g:javascript_plugin_jsdoc = 1
let g:javascript_plugin_ngdoc = 1

vnoremap <leader>z :%s/\%V
"
"Easy regex on visual
vnoremap <leader>r :<C-BS><C-BS><C-BS><C-BS><C-BS>%s/\%V

map  <leader>l   :TagbarToggle<CR>

"Easy fzf
nnoremap <leader>f    :FZF<Space>
nnoremap <leader>a    :FZF /manager<CR>
set rtp+=fzf


let guicursor=""

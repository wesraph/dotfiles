" Remap the leader key
let mapleader = ','

if (has("nvim"))
  let $NVIM_TUI_ENABLE_TRUE_COLOR=1
endif

if (has("termguicolors"))
  set termguicolors
endif

" Indentation
set tabstop=4
set softtabstop=0 noexpandtab "Use real tab and dont convert to space
set shiftwidth=4
set backspace=indent,eol,start
set autoindent    " always set autoindenting on
set copyindent    " copy the previous indentation on autoindenting
set number        " always show line numbers
set shiftround    " use multiple of shiftwidth when indenting with '<' and '>'
set showmatch     " set show matching parenthesis
set ignorecase    " ignore case when searching
set smartcase     " ignore case if search pattern is all lowercase,
                    "    case-sensitive otherwise
set hlsearch      " highlight search terms
set incsearch     " show search matches as you type
set linebreak

if (has("nvim"))
  let $NVIM_TUI_ENABLE_TRUE_COLOR=1
endif

if &t_Co > 2 || has("gui_running")
    syntax on
endif

call plug#begin('~/.config/nvim/plugged')
Plug 'pearofducks/ansible-vim'
Plug 'scrooloose/nerdcommenter'
Plug 'airblade/vim-gitgutter'
Plug 'junegunn/vim-easy-align'
Plug 'OmniSharp/omnisharp-vim'
Plug 'ap/vim-css-color'
Plug 'w0rp/ale'
Plug 'lervag/vimtex'
Plug 'scrooloose/nerdtree'
Plug 'Xuyuanp/nerdtree-git-plugin'
Plug 'vim-scripts/c.vim'
Plug 'csexton/trailertrash.vim'
Plug 'tpope/vim-fugitive'
Plug 'martinda/Jenkinsfile-vim-syntax'
Plug 'alvan/vim-closetag'
Plug 'moll/vim-node'
Plug 'sheerun/vim-polyglot'
Plug 'epilande/vim-react-snippets'

Plug 'joshdick/onedark.vim'
Plug 'prettier/vim-prettier', {
  \ 'do': 'yarn install',
  \ 'branch': 'release/0.x'
  \ }

" Themes
Plug 'drewtempelmeyer/palenight.vim', { 'as': 'palenight' }

Plug 'neoclide/coc.nvim', {'branch': 'release'}
call plug#end()
"
" No mouse
set mouse=

filetype plugin indent on
filetype plugin on
syntax on

" Theme
set background=dark
colorscheme palenight

" History
set history=1000    " much more history than base
set undolevels=1000 " much more undo

" Don't try to highlight lines longer than 800 characters.
set synmaxcol=800

" Menu completion
set wildmenu

" Better indent
vmap > >gv
vmap < <gv

" Set encoding
set encoding=utf-8 nobomb

" Highlight trailing spaces
highlight ExtraWhitespace term=reverse ctermbg=11
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

" Highlight yanked text
augroup highlight_yank
    autocmd!
    autocmd TextYankPost * silent! lua require'vim.highlight'.on_yank("IncSearch", 1000)
augroup END
"
"Easy regex on visual
vnoremap <leader>r :<C-BS><C-BS><C-BS><C-BS><C-BS>%s/\%V

"Easy fzf
nnoremap <leader>f    :FZF<Space>
nnoremap <leader>a    :FZF /manager<CR>
set rtp+=fzf

"Same cursor than vim
set guicursor=

" Keep the old cursor
let $NVIM_TUI_ENABLE_CURSOR_SHAPE = 0

" Change spell language
nnoremap <leader>scfr :setlocal spell spelllang=fr<CR>
nnoremap <leader>scus :setlocal spell spelllang=en<CR>

" Ale
let g:ale_sign_error = '✗'
let g:ale_sign_warning = '⚠'
let g:ale_lint_on_text_changed = 'never'
let g:ale_echo_msg_format = '[%linter%] %s [%severity%]'
let g:ale_linters = {
\ 'cs': ['OmniSharp'],
\ 'go': ['go build', 'gofmt', 'golint', 'gosimple', 'go vet']
\}

"Configure vim for latex
let g:vimtex_view_general_viewer = 'zathura'

" Open nerdtree with ctrl n
map <C-n> :NERDTreeToggle<CR>

" Sudo
nnoremap <leader>sudo :w !sudo tee %

" Enable trailertrash for good
hi UnwantedTrailerTrash guibg=red ctermbg=red
au BufWritePre * :TrailerTrim

" Replace with the first occurence
nnoremap <leader>z 1z=

autocmd BufNewFile,BufRead *.fizz set syntax=sql

" Ansible highlight
let g:ansible_attribute_highlight = "a"

let g:closetag_xhtml_filenames = '*.xhtml,*.jsx, App.js'
let g:closetag_filenames = '*.html,*.xhtml,*.phtml, App.js,*.jsx'

" Syntastic config
let g:syntastic_always_populate_loc_list = 1
let g:syntastic_auto_loc_list = 0
let g:syntastic_check_on_open = 1
let g:syntastic_check_on_wq = 0
let g:syntastic_auto_jump = 0

" Enable usage of omnisharp
let g:OmniSharp_server_stdio = 1
let g:OmniSharp_server_use_mono = 1

" Autocompletion with tab
function! s:check_back_space() abort
  let col = col('.') - 1
  return !col || getline('.')[col - 1]  =~ '\s'
endfunction

inoremap <silent><expr> <cr> pumvisible() ? coc#_select_confirm() : "\<C-g>u\<CR>\<c-r>=coc#on_enter()\<CR>"

inoremap <silent><expr> <Tab>
	  \ pumvisible() ? "\<C-n>" :
	  \ <SID>check_back_space() ? "\<Tab>" :
	  \ coc#refresh()
" GoTo code navigation.
nmap <silent> gd <Plug>(coc-definition)
nmap <silent> gy <Plug>(coc-type-definition)
nmap <silent> gi <Plug>(coc-implementation)
nmap <silent> gr <Plug>(coc-references)
command! -nargs=0 Format :call CocAction('format')
autocmd FileType go nmap gtj :CocCommand go.tags.add json<cr>

" Reorganize import on save
autocmd BufWritePre *.go :call CocAction('runCommand', 'editor.action.organizeImport')
" Vim go configuration
" Set the diagnostic height to max 3
"let g:go_fmt_command = "goimports"
"let g:go_list_height = 3
"" Enable auto-imports
"let g:go_fmt_command = "goimports"
"" Disable vim warning when not using neovim
"let g:go_version_warning = 0

nmap <silent> gd <Plug>(coc-definition)

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

" Web/Nodejs
Plug 'epilande/vim-react-snippets', {'for': ['js']}
Plug 'alvan/vim-closetag', {'for': ['html']}
Plug 'moll/vim-node', {'for': ['js', 'html']}
Plug 'prettier/vim-prettier', {'for': ['js', 'html', 'solidity'], 'do': 'yarn install', 'branch': 'release/0.x'}
" Plug 'kristijanhusak/vim-js-file-import', {'for': ['js'], 'do': 'npm install'}
Plug 'ap/vim-css-color'
Plug 'morhetz/gruvbox'

" Solidity
Plug 'tomlion/vim-solidity'

" Go
Plug 'fatih/vim-go', {'do': ':GoUpdateBinaries' }

" C
Plug 'vim-scripts/c.vim'

" C#
Plug 'OmniSharp/omnisharp-vim'

" Perl
Plug 'vim-perl/vim-perl', {'for': 'perl', 'do': 'make clean carp dancer highlight-all-pragmas moose test-more try-tiny'}

" Yul
Plug 'mattdf/vim-yul'

" Themes
Plug 'drewtempelmeyer/palenight.vim', { 'as': 'palenight' }
Plug 'joshdick/onedark.vim'
Plug 'sheerun/vim-polyglot' " Highlight for all languages

" Git
Plug 'tpope/vim-fugitive' " Git shit
Plug 'Xuyuanp/nerdtree-git-plugin'
Plug 'airblade/vim-gitgutter'

" Misc
Plug 'martinda/Jenkinsfile-vim-syntax'
Plug 'csexton/trailertrash.vim'
Plug 'scrooloose/nerdtree'
Plug 'junegunn/vim-easy-align'
Plug 'pearofducks/ansible-vim'
Plug 'scrooloose/nerdcommenter'
Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}
Plug 'AndrewRadev/splitjoin.vim'
Plug 'jiangmiao/auto-pairs'


" Explore easily with ,ff and ,fg
Plug 'nvim-lua/popup.nvim'
Plug 'nvim-lua/plenary.nvim'
Plug 'nvim-telescope/telescope.nvim'

" Autocomplete/linter
Plug 'w0rp/ale'
Plug 'dcampos/nvim-snippy'
Plug 'dcampos/cmp-snippy'
"Plug 'hrsh7th/cmp-buffer'
Plug 'hrsh7th/cmp-nvim-lsp'
"Plug 'hrsh7th/cmp-path'
Plug 'hrsh7th/nvim-cmp'
Plug 'neovim/nvim-lspconfig'
Plug 'williamboman/mason-lspconfig.nvim'
Plug 'williamboman/mason.nvim'
call plug#end()

" No mouse
set mouse=

" Use indent per filetype
filetype plugin indent on
filetype plugin on
syntax on

let gruvbox_contrast_dark="soft"

" Theme
set background=dark

"colorscheme onedark
colorscheme gruvbox

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
set shortmess=atIc   " Don’t show the intro message when starting Vim
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

" Close all tabs to the right
noremap <leader>dtr .+1,$tabdo :tabc<CR>

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

"Same cursor than vim
set guicursor=
set guicursor+=a:blinkon0

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
let g:ale_fixers= {
\ 'solidity': ['prettier'],
\ 'typescript': ['eslint'],
\ 'rust': ['rustfmt', 'trim_whitespace', 'remove_trailing_lines']
\}
let g:ale_linters = {
\ 'cs': ['OmniSharp'],
\ 'go': ['go build', 'gofmt', 'golint', 'gosimple', 'go vet', 'staticcheck'],
\ 'solidity': ['solhint', 'solc', 'solium'],
\ 'rust': ['analyzer'],
\}

"Configure vim for latex
let g:vimtex_view_general_viewer = 'zathura'

" Open nerdtree with ctrl n
map <C-n> :NERDTreeToggle<CR>
" Same nerdtree on all tabs
"autocmd BufWinEnter * silent NERDTreeMirror

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

" Enable usage of omnisharp
let g:OmniSharp_server_stdio = 1
let g:OmniSharp_server_use_mono = 1

" Telescope
nnoremap <leader>ff <cmd>Telescope find_files<cr>
nnoremap <leader>fg <cmd>Telescope live_grep<cr>

" Treesitter enable syntax highlight
lua <<EOF
require'nvim-treesitter.configs'.setup {
ensure_installed = {"c", "lua", "go", "javascript"},
  highlight = {
    enable = true,              -- false will disable the whole extension
  },
}
EOF

" Golang
let g:go_fmt_fail_silently = 1

" Do not print "SUCCESS" when GoTo definition
let g:go_echo_command_info = 0

" Solidity
autocmd BufWritePre *.sol ALEFix

" JS import
noremap <Leader>if <Plug>(JsFileImport)
autocmd BufWritePre *.ts ALEFix
autocmd BufWritePre *.js ALEFix

" C#
autocmd FileType cs setlocal omnifunc=OmniSharp#Complete

" Lsp
set omnifunc=syntaxcomplete#Complete

" To restart gopls: :call go#lsp#Exit()

" Shortcut to quickly close the tab
map <C-x> :tab close<CR>

" Copy the same tab in new tab
map <leader>ct :tab split<CR>

" Print the hexadecimal value in decimal
vnoremap <leader>h y:echo str2nr('<C-r>0', 16)<CR>

lua <<EOF
 -- Setup nvim-cmp.
  local cmp = require'cmp'

  local has_words_before = function()
  local line, col = unpack(vim.api.nvim_win_get_cursor(0))
    return col ~= 0 and vim.api.nvim_buf_get_lines(0, line - 1, line, true)[1]:sub(col, col):match("%s") == nil
  end

  local feedkey = function(key, mode)
    vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(key, true, true, true), mode, true)
  end
  local snippy = require("snippy")

  require("mason").setup()
  require("mason-lspconfig").setup()


  cmp.setup({
    comparators = {
      cmp.config.compare.score,
      cmp.config.compare.offset,
      cmp.config.compare.exact,
      cmp.config.compare.kind,
      -- cmp.config.compare.sort_text,
      cmp.config.compare.length,
      cmp.config.compare.order,
    },

    appearance = {
      menu = {
        direction = 'auto' -- auto or above or below
      }
    },

    snippet = {
      -- REQUIRED - you must specify a snippet engine
      expand = function(args)
          require('snippy').expand_snippet(args.body)
      end,
    },
    window = {
      completion = {
        completeopt = 'menu,menuone,noinsert'
      },
      documentation = false,
    },
    mapping = cmp.mapping.preset.insert({
      ['<C-b>'] = cmp.mapping.scroll_docs(-4),
      ['<C-f>'] = cmp.mapping.scroll_docs(4),
      ['<C-Space>'] = cmp.mapping.complete(),
      ['<C-e>'] = cmp.mapping.abort(),
      ['<CR>'] = cmp.mapping.confirm({ select = true }), -- Accept currently selected item. Set `select` to `false` to only confirm explicitly selected items.

      ["<Tab>"] = cmp.mapping(function(fallback)
        if cmp.visible() then
          cmp.select_next_item()
        elseif snippy.can_expand_or_advance() then
          snippy.expand_or_advance()
        elseif has_words_before() then
          cmp.complete()
        else
          fallback()
        end
      end, { "i", "s" }),

      ["<C-j>"] = cmp.mapping(function(fallback)
          if snippy.can_expand_or_advance() then
            snippy.expand_or_advance()
          elseif has_words_before() then
            cmp.complete()
          else
            fallback()
          end
      end, { "i", "s" }),

      ["<C-k>"] = cmp.mapping(function(fallback)
        if snippy.can_jump(-1) then
          snippy.previous()
        else
          fallback()
        end
      end, { "i", "s" }),

      ["<S-Tab>"] = cmp.mapping(function(fallback)
        if cmp.visible() then
          cmp.select_prev_item()
        elseif snippy.can_jump(-1) then
          snippy.previous()
        else
          fallback()
        end
      end, { "i", "s" }),

    }),
    sources = cmp.config.sources({
      { name = 'nvim_lsp' },
      { name = 'snippy' }, -- For vsnip users.
    }, {
    })
  })

  -- Set configuration for specific filetype.
  cmp.setup.filetype('gitcommit', {
    sources = cmp.config.sources({
      { name = 'cmp_git' }, -- You can specify the `cmp_git` source if you were installed it.
    }, {
      { name = 'buffer' },
    })
  })

  -- Use buffer source for `/` (if you enabled `native_menu`, this won't work anymore).
  cmp.setup.cmdline('/', {
    mapping = cmp.mapping.preset.cmdline(),
    sources = {
      { name = 'buffer' }
    }
  })

  -- Use cmdline & path source for ':' (if you enabled `native_menu`, this won't work anymore).
  cmp.setup.cmdline(':', {
    mapping = cmp.mapping.preset.cmdline(),
    sources = cmp.config.sources({
      { name = 'path' }
    }, {
      { name = 'cmdline' }
    })
  })

  -- Setup lspconfig.
  local capabilities = require('cmp_nvim_lsp').update_capabilities(vim.lsp.protocol.make_client_capabilities())
  -- Replace <YOUR_LSP_SERVER> with each lsp server you've enabled.
  require('lspconfig')['gopls'].setup {
     cmd = {'gopls'},
      on_attach = on_attach,
      capabilities = capabilities,
      settings = {
        gopls = {
          experimentalPostfixCompletions = true,
          analyses = {
            unusedparams = true,
            shadow = false,
          },
          staticcheck = true,
        },
      },
      init_options = {
        usePlaceholders = true,
      }
  }
EOF

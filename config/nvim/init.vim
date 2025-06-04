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
set scl=yes " Stop all the text moving everytime there is an error

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

" Huff
Plug 'marktoda/vim-huff'

" Rust
Plug 'rust-lang/rust.vim'
"Plug 'mrcjkb/rustaceanvim'

" Themes
Plug 'drewtempelmeyer/palenight.vim', { 'as': 'palenight' }
Plug 'joshdick/onedark.vim'
Plug 'sheerun/vim-polyglot' " Highlight for all languages
Plug 'sainnhe/gruvbox-material'

" Git
Plug 'tpope/vim-fugitive' " Git shit
Plug 'tpope/vim-rhubarb'
Plug 'Xuyuanp/nerdtree-git-plugin'
Plug 'airblade/vim-gitgutter'

" Misc
Plug 'powerman/vim-plugin-AnsiEsc'
Plug 'ggandor/leap.nvim'
Plug 'martinda/Jenkinsfile-vim-syntax'
Plug 'csexton/trailertrash.vim'
Plug 'scrooloose/nerdtree'
Plug 'junegunn/vim-easy-align'
Plug 'pearofducks/ansible-vim'
Plug 'scrooloose/nerdcommenter'
Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}
Plug 'AndrewRadev/splitjoin.vim'
Plug 'jiangmiao/auto-pairs'
Plug 'nvim-treesitter/nvim-treesitter-context'
Plug 'iamcco/markdown-preview.nvim', { 'do': 'cd app && yarn install' }
Plug 'HakonHarnes/img-clip.nvim'
Plug 'nvim-tree/nvim-web-devicons'
Plug 'lervag/vimtex'

" Explore easily with ,ff and ,fg
Plug 'nvim-lua/popup.nvim'
Plug 'MunifTanjim/nui.nvim'
Plug 'nvim-lua/plenary.nvim'
Plug 'nvim-telescope/telescope.nvim'

" Autocomplete/linter
Plug 'neovim/nvim-lspconfig'
Plug 'simrat39/rust-tools.nvim'
Plug 'hrsh7th/cmp-nvim-lsp'
Plug 'hrsh7th/cmp-buffer'
Plug 'hrsh7th/cmp-path'
Plug 'hrsh7th/cmp-cmdline'
Plug 'hrsh7th/nvim-cmp', { 'branch': 'main' }
Plug 'rafamadriz/friendly-snippets'
Plug 'hrsh7th/cmp-vsnip'
Plug 'hrsh7th/vim-vsnip'
Plug 'mfussenegger/nvim-jdtls'
Plug 'williamboman/mason.nvim'
Plug 'williamboman/mason-lspconfig.nvim'
Plug 'yetone/avante.nvim', { 'branch': 'main', 'do': 'make' }

" Deps of avante
Plug 'stevearc/dressing.nvim'
Plug 'MeanderingProgrammer/render-markdown.nvim'
call plug#end()

" No mouse
set mouse=

" Use indent per filetype
filetype plugin indent on
filetype plugin on
syntax on

" Theme
set background=dark
let gruvbox_contrast_dark="soft"
let gruvbox_contrast_light="medium"
let g:gruvbox_material_background = "soft"
colorscheme gruvbox-material

function SetLightTheme()
  set background=light
endfunction

function SetDarkTheme()
  set background=dark
endfunction

" History
set history=1000    " much more history than base
set undolevels=1000 " much more undo

" Don't try to highlight lines longer than 800 characters.
set synmaxcol=800

" Menu completion
set wildmenu
"set wildmode=longest,list:full

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

noremap ga :Telescope diagnostics theme=dropdown prompt_title=diagnostics previewer=true<CR>

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
ensure_installed = {"c", "lua", "go", "javascript", "solidity", "rust", "html"},
  highlight = {
    enable = true,
  },
}
EOF

" Golang
let g:go_fmt_fail_silently = 1

" Do not print "SUCCESS" when GoTo definition
let g:go_echo_command_info = 0


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

set completeopt=menu,menuone,noselect

lua require('leap').add_default_mappings()

function! CheckBackspace() abort
  let col = col('.') - 1
  return !col || getline('.')[col - 1]  =~# '\s'
endfunction

function! DisableAutism()
  set mouse=a
  map <Up> <Up>
  map <Down> <Down>
  map <Left> <Left>
  map <Right> <Right>
endfunction

function! EnableAutism()
  set mouse=
  map <Left>  <C-W><
  map <Right> <C-W>>
  map <Up>    <C-W>+
  map <Down>  <C-W>-
endfunction

let g:coq_settings = { 'auto_start': 'shut-up' }

" Vsnip configuration
" Expand
"imap <expr> <C-j>   vsnip#expandable()  ? '<Plug>(vsnip-expand)'         : '<C-j>'
"smap <expr> <C-j>   vsnip#expandable()  ? '<Plug>(vsnip-expand)'         : '<C-j>'

" Expand or jump
imap <expr> <C-l>   vsnip#available(1)  ? '<Plug>(vsnip-expand-or-jump)' : '<C-l>'
smap <expr> <C-l>   vsnip#available(1)  ? '<Plug>(vsnip-expand-or-jump)' : '<C-l>'

" Jump forward or backward
imap <expr> <C-j>   vsnip#jumpable(1)   ? '<Plug>(vsnip-jump-next)'      : '<Tab>'
smap <expr> <C-j>   vsnip#jumpable(1)   ? '<Plug>(vsnip-jump-next)'      : '<Tab>'
imap <expr> <C-k> vsnip#jumpable(-1)  ? '<Plug>(vsnip-jump-prev)'      : '<S-Tab>'
smap <expr> <C-k> vsnip#jumpable(-1)  ? '<Plug>(vsnip-jump-prev)'      : '<S-Tab>'

autocmd BufRead,BufNewFile *.tsx set filetype=typescriptreact

lua <<EOF
  vim.keymap.set("n", "K", vim.lsp.buf.hover, opts)
  vim.keymap.set("n", "gD", vim.lsp.buf.implementation, opts)
  vim.keymap.set("n", "gr", vim.lsp.buf.references, opts)
  vim.keymap.set("n", "g0", vim.lsp.buf.document_symbol, opts)
  vim.keymap.set("n", "gW", vim.lsp.buf.workspace_symbol, opts)
  vim.keymap.set("n", "gd", vim.lsp.buf.definition, opts)

  -- Set up mason
  require("telescope").setup()
  require("mason").setup()
  require("mason-lspconfig").setup()
  require('avante').setup (
  {
    ---@alias Provider "claude" | "openai" | "azure" | "gemini" | "cohere" | "copilot" | string
    provider = "aihubmix", -- The provider used in Aider mode or in the planning phase of Cursor Planning Mode
    mode = "legacy", -- The default mode for interaction. "agentic" uses tools to automatically generate code, "legacy" uses the old planning method to generate code.
    -- WARNING: Since auto-suggestions are a high-frequency operation and therefore expensive,
    -- currently designating it as `copilot` provider is dangerous because: https://github.com/yetone/avante.nvim/issues/1048
    -- Of course, you can reduce the request frequency by increasing `suggestion.debounce`.
    -- auto_suggestions_provider = "claude",
    cursor_applying_provider = nil, -- The provider used in the applying phase of Cursor Planning Mode, defaults to nil, when nil uses Config.provider as the provider for the applying phase
    vendors = {
      llamacpp = {
        __inherited_from = 'openai',
          --model = "JollyLlama/GLM-4-32B-0414-Q4_K_M:latest",
          endpoint = "http://taildesk:11434/v1",
          --disable_tools = true, -- Open-source models often do not support tools.
      },
      localllama = {
          __inherited_from = 'ollama',
          model = "gemma3:4b-it-qat",
          --model = "JollyLlama/GLM-4-32B-0414-Q4_K_M:latest",
          endpoint = "http://localhost:11434",
          --disable_tools = true, -- Open-source models often do not support tools.
      },
    },
    aihubmix = {
      __inherited_from = 'openai',
      model = "deepseek-ai/DeepSeek-V3-0324",
      --model = "gemini-2.5-pro-preview-05-06-search",
      --model = "claude-3-7-sonnet-20250219",
      --model = "gemini-2.5-flash-preview-04-17",
      max_completion_tokens = 12288,
          --disable_tools = true, -- disable tools!
      endpoint = "https://aihubmix.com/v1",
      api_key_name = 'AIHUBMIX_API_KEY',
    },
    ollama = {
      --model = "qwen2.5-coder:32b-instruct-q4_K_M",
      --model = "gemma3:27b-it-qat",
      --model = "qwen3:32b",
      model = "deepseek-r1:8b",
      --model = "hf.co/unsloth/Qwen3-30B-A3B-GGUF",
      options = {
        num_ctx = 32000,
        temperature = 0.6,
      },
      endpoint = "http://taildesk:11434",
    },
    behaviour = {
      auto_suggestions = false, -- Experimental stage
      auto_set_highlight_group = true,
      auto_set_keymaps = true,
      auto_apply_diff_after_generation = false,
      support_paste_from_clipboard = false,
      minimize_diff = true, -- Whether to remove unchanged lines when applying a code block
      enable_token_counting = true, -- Whether to enable token counting. Default to true.
      enable_cursor_planning_mode = false, -- Whether to enable Cursor Planning Mode. Default to false.
      enable_claude_text_editor_tool_mode = false, -- Whether to enable Claude Text Editor Tool Mode.
    },
    mappings = {
      --- @class AvanteConflictMappings
      diff = {
        ours = "co",
        theirs = "ct",
        all_theirs = "ca",
        both = "cb",
        cursor = "cc",
        next = "]x",
        prev = "[x",
      },
      suggestion = {
        accept = "<M-l>",
        next = "<M-]>",
        prev = "<M-[>",
        dismiss = "<C-]>",
      },
      jump = {
        next = "]]",
        prev = "[[",
      },
      submit = {
        normal = "<CR>",
        insert = "<C-s>",
      },
      cancel = {
        normal = { "<C-c>", "<Esc>", "q" },
        insert = { "<C-c>" },
      },
      sidebar = {
        apply_all = "A",
        apply_cursor = "a",
        retry_user_request = "r",
        edit_user_request = "e",
        switch_windows = "<Tab>",
        reverse_switch_windows = "<S-Tab>",
        remove_file = "d",
        add_file = "@",
        close = { "<Esc>", "q" },
        close_from_input = nil, -- e.g., { normal = "<Esc>", insert = "<C-d>" }
      },
    },
    hints = { enabled = true },
    windows = {
      ---@type "right" | "left" | "top" | "bottom"
      position = "right", -- the position of the sidebar
      wrap = true, -- similar to vim.o.wrap
      width = 30, -- default % based on available width
      sidebar_header = {
        enabled = true, -- true, false to enable/disable the header
        align = "center", -- left, center, right for title
        rounded = true,
      },
      input = {
        prefix = "> ",
        height = 8, -- Height of the input window in vertical layout
      },
      edit = {
        border = "rounded",
        start_insert = true, -- Start insert mode when opening the edit window
      },
      ask = {
        floating = false, -- Open the 'AvanteAsk' prompt in a floating window
        start_insert = true, -- Start insert mode when opening the ask window
        border = "rounded",
        ---@type "ours" | "theirs"
        focus_on_apply = "ours", -- which diff to focus after applying
      },
    },
    highlights = {
      ---@type AvanteConflictHighlights
      diff = {
        current = "DiffText",
        incoming = "DiffAdd",
      },
    },
    --- @class AvanteConflictUserConfig
    diff = {
      autojump = true,
      ---@type string | fun(): any
      list_opener = "copen",
      --- Override the 'timeoutlen' setting while hovering over a diff (see :help timeoutlen).
      --- Helps to avoid entering operator-pending mode with diff mappings starting with `c`.
      --- Disable by setting to -1.
      override_timeoutlen = 500,
    },
    suggestion = {
      debounce = 600,
      throttle = 600,
    },
  }
  )

  local has_words_before = function()
    unpack = unpack or table.unpack
    local line, col = unpack(vim.api.nvim_win_get_cursor(0))
    return col ~= 0 and vim.api.nvim_buf_get_lines(0, line - 1, line, true)[1]:sub(col, col):match("%s") == nil
  end

  local feedkey = function(key, mode)
    vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(key, true, true, true), mode, true)
  end

  vim.keymap.set('n', '<C-s>j', ':silent! lnext<CR>:silent! cnext<CR>zz', { noremap = true, silent = true })
  vim.keymap.set('n', '<C-s>k', ':silent! lprev<CR>:silent! cprev<CR>zz', { noremap = true, silent = true })

  vim.api.nvim_create_autocmd("FileType", {
    pattern = "qf",
    callback = function()
    vim.keymap.set("n", "<CR>", "<CR>:silent! redraw!<CR>", { buffer = true, silent = true })
    end,
  })


  -- Set up nvim-cmp.
  local cmp = require'cmp'

  cmp.setup({
    snippet = {
      expand = function(args)
      vim.fn["vsnip#anonymous"](args.body) -- For `vsnip` users.
      end,
    },
    window = {
      -- completion = cmp.config.window.bordered(),
      -- documentation = cmp.config.window.bordered(),
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
      elseif vim.fn["vsnip#available"](1) == 1 then
        feedkey("<Plug>(vsnip-expand-or-jump)", "")
      elseif has_words_before() then
        cmp.complete()
      else
        fallback() -- The fallback function sends a already mapped key. In this case, it's probably `<Tab>`.
      end
    end, { "i", "s" }),

    ["<S-Tab>"] = cmp.mapping(function()
      if cmp.visible() then
        cmp.select_prev_item()
      elseif vim.fn["vsnip#jumpable"](-1) == 1 then
        feedkey("<Plug>(vsnip-jump-prev)", "")
      end
    end, { "i", "s" }),
    }),
    sources = cmp.config.sources({
      { name = 'nvim_lsp' },
      { name = 'nvim_lsp_signature_help'},
      { name = 'vsnip' }, -- For vsnip users.
    }, {
      { name = 'buffer' },
    })
  })

  -- Set configuration for specific filetype.
  cmp.setup.filetype('gitcommit', {
    sources = cmp.config.sources({
      { name = 'git' }, -- You can specify the `git` source if [you were installed it](https://github.com/petertriho/cmp-git).
    }, {
      { name = 'buffer' },
    })
  })

  -- Use buffer source for `/` and `?` (if you enabled `native_menu`, this won't work anymore).
  cmp.setup.cmdline({ '/', '?' }, {
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

  -- Set up lspconfig.
  local capabilities = require('cmp_nvim_lsp').default_capabilities()
  capabilities.textDocument.completion.completionItem.snippetSupport = true

  local lsp = require'lspconfig'
  lsp.jdtls.setup{
  }
  local lspconfig = require'lspconfig'


  -- Function to check if a file is a Rust file
local function is_rust_file(bufnr)
  local file_type = vim.api.nvim_buf_get_option(bufnr, 'filetype')
  return file_type == 'rust'
end

-- Function to format Rust files
local function format_rust_file()
  if is_rust_file(0) then
    vim.lsp.buf.format({ async = false })
  else
    print("Not a Rust file, skipping format")
  end
end

local rt = require("rust-tools")

rt.setup({
  server = {
    on_attach = function(_, bufnr)
      -- Hover actions
      vim.keymap.set("n", "<C-space>", rt.hover_actions.hover_actions, { buffer = bufnr })
      -- Code action groups
      vim.keymap.set("n", "<Leader>a", rt.code_action_group.code_action_group, { buffer = bufnr })

      -- Enable formatting on save
      vim.api.nvim_create_autocmd("BufWritePre", {
        group = vim.api.nvim_create_augroup("RustFormat", { clear = true }),
        buffer = bufnr,
        callback = function()
          vim.lsp.buf.format({ bufnr = bufnr })
        end,
      })

      -- Other keybindings
      local opts = { noremap = true, silent = true, buffer = bufnr }
      print("rust-tools attached")
    end,
    capabilities = capabilities,
    settings = {
      ["rust-analyzer"] = {
        assist = {
          importGranularity = "module",
          importPrefix = "self",
        },
        cargo = {
          loadOutDirsFromCheck = true
        },
        procMacro = {
          enable = true
        },
        checkOnSave = {
          command = "clippy"
        },
        completion = {
          postfix = {
            enable = true,
          },
          callable = {
            snippets = {
              fill_arguments = true,
            },
          },
        },
      }
    },
  },
  tools = {
    -- Autoformat on save
    autoSetHints = true,
    inlay_hints = {
      show_parameter_hints = true,
      parameter_hints_prefix = "",
      other_hints_prefix = "",
    },
  },
})

-- Manual formatting command
vim.api.nvim_create_user_command("RustFormat", format_rust_file, {})

  lspconfig.ccls.setup({
    capabilities = capabilities,
  })

  lsp.gopls.setup{
  capabilities = capabilities,
  settings = {
    gopls = {
      experimentalPostfixCompletions = true,
      analyses = {
        unusedparams = true,
        shadow = true,
      },
      staticcheck = true,
      hints = {
        assignVariableTypes = true,
        compositeLiteralFields = true,
        compositeLiteralType = true,
        constantValues = true,
        functionTypeParameters = true,
        parameterNames = true,
        rangeVariableTypes = false,
      },
      usePlaceholders = true,
    },
  },
  }

  vim.filetype.add({
  extension = {
    tsx = "typescriptreact",
  }})

  -- TypeScript
  lsp.ts_ls.setup {
    capabilities = capabilities,
    on_attach = on_attach,
    filetypes = {  "typescriptreact", "typescript", "typescript.tsx" },
    cmd = { "typescript-language-server", "--stdio" },
    root_dir = lsp.util.root_pattern("package.json", "tsconfig.json", "jsconfig.json", ".git"),
  }

  if (not status) then return end
    local protocol = require('vim.lsp.protocol')

EOF

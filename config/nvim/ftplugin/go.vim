setlocal noexpandtab     " use tabs instead of spaces
setlocal tabstop=4       " use 4 tabs
setlocal shiftwidth=4    " autoindent with 4 tabs
setlocal softtabstop=4   " 4 spaces to represent a tab

let g:go_fmt_command = "goimports"
let g:go_gopls_use_placeholders = "true"
let g:go_list_height = 3

let b:ale_linters = ['go build', 'gofmt', 'golint', 'go vet']

"lua require'lspconfig'.gopls.setup{on_attach=require'completion'.on_attach}

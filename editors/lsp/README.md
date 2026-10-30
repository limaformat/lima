# Lima Language Server

Language Server Protocol support for [Lima](https://limaformat.dev). The
server reports parser errors and warnings, explains References 2.1 tokens on
hover, and navigates `${document.path}` references to their definitions.
These features work in standalone `.lima` files and in Lima frontmatter in
Markdown and MDX documents.

Node.js 22 or newer is required. The bundled Core 1.2 parser uses
`String.prototype.isWellFormed()` to reject invalid Unicode scalar values.

## Usage

Configure an LSP client to run:

```sh
npx --yes @limaformat/lima-language-server --stdio
```

Use the language ID `lima` for `.lima` files. The server also accepts
documents whose language ID is `markdown` or `mdx` and checks a leading
`---` frontmatter block. Whether an editor sends Markdown or MDX documents
to this server is controlled by that editor's LSP client configuration, so
embedded-frontmatter support is not available uniformly in every editor.

The setups below provide diagnostics and document-reference navigation.
Sublime Text and Emacs can also use the syntax definitions shipped in this
package. Standalone `.lima` files are the reliable target; attaching the
server to Markdown or MDX is possible only when a client's document-routing
configuration can send those documents with the matching language ID.

## Editor setup

### Neovim 0.11+

Neovim 0.11 added the built-in `vim.lsp.config` API. Add this to `init.lua`:

```lua
vim.filetype.add({
  extension = { lima = "lima" },
})

vim.lsp.config("lima_ls", {
  cmd = { "npx", "--yes", "@limaformat/lima-language-server", "--stdio" },
  filetypes = { "lima" },
})

vim.lsp.enable("lima_ls")
```

See Neovim's [LSP configuration documentation](https://neovim.io/doc/user/lsp).
For older Neovim versions using the legacy `nvim-lspconfig` setup API, define
the custom server explicitly:

```lua
vim.filetype.add({
  extension = { lima = "lima" },
})

local configs = require("lspconfig.configs")
local util = require("lspconfig.util")

if not configs.lima_ls then
  configs.lima_ls = {
    default_config = {
      cmd = { "npx", "--yes", "@limaformat/lima-language-server", "--stdio" },
      filetypes = { "lima" },
      root_dir = util.root_pattern(".git"),
      single_file_support = true,
    },
  }
end

require("lspconfig").lima_ls.setup({})
```

The legacy `require("lspconfig").…setup()` API is deprecated on Neovim 0.11
and newer; prefer the first configuration there.

#### Syntax highlighting

The repository ships a [`tree-sitter-lima`](../tree-sitter-lima/) grammar. On
nvim-treesitter's `main` branch (Neovim 0.12+), register it as a third-party
parser so `:TSInstall lima` compiles it from the pinned monorepo commit and
installs its highlight query:

```lua
vim.api.nvim_create_autocmd("User", {
  pattern = "TSUpdate",
  callback = function()
    require("nvim-treesitter.parsers").lima = {
      install_info = {
        url = "https://github.com/limaformat/lima",
        revision = "833a953c3b2ed5c16bb9db64040cce86098839ca",
        location = "editors/tree-sitter-lima",
        queries = "editors/tree-sitter-lima/queries",
      },
    }
  end,
})

vim.api.nvim_create_autocmd("FileType", {
  pattern = "lima",
  callback = function()
    -- Neovim's own runtimepath scan for parsers and queries does not pick
    -- up files that :TSInstall wrote earlier in the same session, so the
    -- very first .lima file opened right after installing needs the
    -- parser and query registered explicitly instead of relying on
    -- vim.treesitter.start()'s auto-discovery — otherwise it fails with
    -- "Parser could not be created for buffer ... and language 'lima'".
    local install_dir = vim.fn.stdpath("data") .. "/site"
    if not pcall(vim.treesitter.language.add, "lima", { path = install_dir .. "/parser/lima.so" }) then
      return
    end
    if not vim.treesitter.query.get("lima", "highlights") then
      local file = io.open(install_dir .. "/queries/lima/highlights.scm", "r")
      if file then
        vim.treesitter.query.set("lima", "highlights", file:read("*a"))
        file:close()
      end
    end
    vim.treesitter.start()
  end,
})
```

Highlighting is not enabled automatically, so the `FileType` autocmd above
starts it. The explicit `language.add`/`query.set` calls are only needed
because the parser was just installed in the same session — a Neovim
restart after `:TSInstall lima` works fine with just `vim.treesitter.start()`.

nvim-treesitter's frozen `master` branch (Neovim 0.11) uses a different custom
parser API: `get_parser_configs()` with `files` and `revision`. It does not
support `location` and does not copy queries from the grammar repository:

```lua
local parser_config = require("nvim-treesitter.parsers").get_parser_configs()
parser_config.lima = {
  install_info = {
    url = "https://github.com/limaformat/lima",
    files = {
      "editors/tree-sitter-lima/src/parser.c",
      "editors/tree-sitter-lima/src/scanner.c",
    },
    revision = "833a953c3b2ed5c16bb9db64040cce86098839ca",
  },
}

require("nvim-treesitter.configs").setup {
  highlight = { enable = true },
}
```

On `master`, also copy `editors/tree-sitter-lima/queries/highlights.scm` to
`queries/lima/highlights.scm` on your runtime path, since that branch does not
install queries from the grammar.

### Helix

Add this to your [`languages.toml`](https://docs.helix-editor.com/languages.html):

```toml
[[language]]
name = "lima"
scope = "source.lima"
file-types = ["lima"]
language-id = "lima"
language-servers = ["lima-ls"]

[language-server.lima-ls]
command = "npx"
args = ["--yes", "@limaformat/lima-language-server", "--stdio"]

[[grammar]]
name = "lima"
source = { git = "https://github.com/limaformat/lima", rev = "833a953c3b2ed5c16bb9db64040cce86098839ca", subpath = "editors/tree-sitter-lima" }
```

Helix has no built-in `.lima` association, so the `[[language]]` block is
required, not optional. After adding the `[[grammar]]` entry, run
`hx --grammar fetch && hx --grammar build`. The grammar's
`queries/highlights.scm` needs to be copied to
`runtime/queries/lima/highlights.scm` for syntax highlighting.

### Zed

The repository now includes a [Zed extension](../zed/) that associates `.lima`
files with this server. It is not published in Zed's extension registry yet;
install it from a checkout with **Extensions: Install Dev Extension** and select
the `editors/zed` directory. Zed then installs and updates the npm language
server in the extension's private working directory.

The extension provides diagnostics, document-reference navigation, and syntax
highlighting backed by the `tree-sitter-lima` grammar, which the extension pins
in its manifest. See the
[extension README](../zed/README.md) and Zed's
[development guide](https://zed.dev/docs/extensions/developing-extensions) for
the installation steps.

### Sublime Text

Copy [`syntaxes/lima.sublime-syntax`](./syntaxes/lima.sublime-syntax) to
`Packages/User/Lima.sublime-syntax` in your Sublime Text data directory. The
syntax assigns `.lima` files the `source.lima` scope and highlights Lima Core
1.2 plus active References 2.1 tokens.

Install Sublime's [LSP package](https://lsp.sublimetext.io/), then add this
client under `clients` in `Packages/User/LSP.sublime-settings`:

```json
{
  "clients": {
    "lima": {
      "enabled": true,
      "command": [
        "npx",
        "--yes",
        "@limaformat/lima-language-server",
        "--stdio"
      ],
      "selector": "source.lima"
    }
  }
}
```

The same entry can be placed in Sublime LSP's current custom-server file,
`Packages/User/LanguageServers.sublime-settings`, without the surrounding
`clients` object; see the
[client-configuration documentation](https://lsp.sublimetext.io/client_configuration/).

Unquoted keys and reference components use Oniguruma's `\p{L}`, `\p{M}`, and
`\p{N}` properties, so their Unicode version follows Sublime's bundled engine
rather than Core 1.2's fixed Unicode 18.0 table at newly assigned code points.
The included syntax makes the `source.lima` selector usable for standalone
`.lima` files. Markdown/MDX frontmatter injection is not included, so Sublime
syntax highlighting is currently limited to standalone files.

### JetBrains IDEs

The repository includes a [JetBrains companion plugin](../jetbrains/) that
registers this server and maps `*.lima` automatically through
[LSP4IJ](https://plugins.jetbrains.com/plugin/23257-lsp4ij). Until it is
published to JetBrains Marketplace, build and install its ZIP from disk as
described in the [companion README](../jetbrains/README.md). No Generic LSP
Server settings are needed after installing it.

For a manual setup without the companion, install LSP4IJ and add a user-defined
(Generic LSP) server under **Settings | Languages & Frameworks | Language
Servers** with:

```text
Name: Lima
Command: npx --yes @limaformat/lima-language-server --stdio
Mapping: file name pattern *.lima
Language ID: lima
```

LSP4IJ's
[user-defined server guide](https://github.com/redhat-developer/lsp4ij/blob/main/docs/UserDefinedLanguageServer.md)
shows the corresponding Server and Mappings tabs. This provides diagnostics
and document-reference navigation. Neither setup installs Lima-specific syntax
highlighting.

### Emacs 29+

Add the directory containing [`emacs/lima-mode.el`](./emacs/lima-mode.el) to
`load-path`, then load the mode. It derives from `prog-mode`, associates the
`.lima` extension, and provides Lima Core 1.2 and active References 2.1
font-lock highlighting. Eglot is built into Emacs 29; add its server entry and
hook alongside the mode:

```elisp
(add-to-list 'load-path "/path/to/lima/editors/lsp/emacs")
(require 'lima-mode)

(with-eval-after-load 'eglot
  (add-to-list 'eglot-server-programs
               '(lima-mode . ("npx"
                              "--yes"
                              "@limaformat/lima-language-server"
                              "--stdio"))))

(add-hook 'lima-mode-hook #'eglot-ensure)
```

See the GNU Eglot manual's server-setup
[documentation](https://www.gnu.org/software/emacs/manual/html_node/eglot/Setting-Up-LSP-Servers.html).

## Configuration

The server accepts these settings through `initializationOptions` or
`workspace/didChangeConfiguration`, nested under `lima.diagnostics`:

- `lima.diagnostics.strict` (default: `true`)
- `lima.diagnostics.ignoreUnresolvedReferences` (default: `true`)

Unresolved document references and partial-related findings are hidden by
default. The shared setting is conservative: partial references need
caller-provided context, while document references can be resolved locally.

## Reference navigation

Hovering over an active `${key}` or `${nested.path}` token shows whether its
document path resolves. Go to Definition jumps a resolved document reference
to the line containing its target key. Lima's positioned parse tree records
the target value's line but not the key's exact column, so the destination is
the start of that line.

Hovering over `$(key)` explains that it is a partial reference whose value is
supplied by the caller. Partial references intentionally have no definition
target because Lima specifies no source-file convention for them. Quoted or
commented reference-shaped text remains literal and receives neither feature.

Emacs has no equivalent fixed general-category property class. The mode uses
its Unicode-aware `[[:alnum:]]` class plus the combining-diacritic category;
coverage and Unicode version follow the running Emacs and may differ for
non-decimal numbers, spacing marks, or newly assigned Unicode 18.0 code points.

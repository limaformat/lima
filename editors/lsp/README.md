# Lima Language Server

Language Server Protocol support for [Lima](https://limaformat.dev). The
server reports parser errors and warnings, explains References 2.0 tokens on
hover, and navigates `${document.path}` references to their definitions.
These features work in standalone `.lima` files and in Lima frontmatter in
Markdown and MDX documents.

## Usage

Configure an LSP client to run:

```sh
npx @limaformat/lima-language-server --stdio
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
  cmd = { "npx", "@limaformat/lima-language-server", "--stdio" },
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
      cmd = { "npx", "@limaformat/lima-language-server", "--stdio" },
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
args = ["@limaformat/lima-language-server", "--stdio"]
```

Helix has no built-in `.lima` association, so the `[[language]]` block is
required, not optional.

### Zed

The repository now includes a [Zed extension](../zed/) that associates `.lima`
files with this server. It is not published in Zed's extension registry yet;
install it from a checkout with **Extensions: Install Dev Extension** and select
the `editors/zed` directory. Zed then installs and updates the npm language
server in the extension's private working directory.

The extension provides diagnostics and document-reference navigation. It uses
tree-sitter-yaml only as the structural grammar needed to register the Lima
language and does not claim accurate Lima syntax highlighting. See the
[extension README](../zed/README.md) and Zed's
[development guide](https://zed.dev/docs/extensions/developing-extensions) for
the installation steps and current highlighting limitation.

### Sublime Text

Copy [`syntaxes/lima.sublime-syntax`](./syntaxes/lima.sublime-syntax) to
`Packages/User/Lima.sublime-syntax` in your Sublime Text data directory. The
syntax assigns `.lima` files the `source.lima` scope and highlights Lima Core
1.0 plus active References 2.0 tokens.

Install Sublime's [LSP package](https://lsp.sublimetext.io/), then add this
client under `clients` in `Packages/User/LSP.sublime-settings`:

```json
{
  "clients": {
    "lima": {
      "enabled": true,
      "command": [
        "npx",
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

The included syntax makes the `source.lima` selector usable for standalone
`.lima` files. Markdown/MDX frontmatter injection is not included, so Sublime
syntax highlighting is currently limited to standalone files.

### JetBrains IDEs

Install [LSP4IJ](https://plugins.jetbrains.com/plugin/23257-lsp4ij) in IntelliJ
IDEA, WebStorm, or another compatible JetBrains IDE. Under **Settings |
Languages & Frameworks | Language Servers**, add a user-defined (Generic LSP)
server with:

```text
Name: Lima
Command: npx @limaformat/lima-language-server --stdio
Mapping: file name pattern *.lima
Language ID: lima
```

LSP4IJ's
[user-defined server guide](https://github.com/redhat-developer/lsp4ij/blob/main/docs/UserDefinedLanguageServer.md)
shows the corresponding Server and Mappings tabs. This provides diagnostics
and document-reference navigation; it does not install Lima-specific syntax
highlighting.

### Emacs 29+

Add the directory containing [`emacs/lima-mode.el`](./emacs/lima-mode.el) to
`load-path`, then load the mode. It derives from `prog-mode`, associates the
`.lima` extension, and provides Lima Core 1.0 and active References 2.0
font-lock highlighting. Eglot is built into Emacs 29; add its server entry and
hook alongside the mode:

```elisp
(add-to-list 'load-path "/path/to/lima/editors/lsp/emacs")
(require 'lima-mode)

(with-eval-after-load 'eglot
  (add-to-list 'eglot-server-programs
               '(lima-mode . ("npx"
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

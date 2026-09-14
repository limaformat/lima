# Lima Language Server

Language Server Protocol diagnostics for [Lima](https://limaformat.dev).
The server reports parser errors and warnings for standalone `.lima` files
and for Lima frontmatter in Markdown and MDX documents.

## Usage

Configure an LSP client to run:

```sh
npx @limaformat/lima-language-server --stdio
```

Use the language ID `lima` for `.lima` files. The server also accepts
documents whose language ID is `markdown` or `mdx` and checks a leading
`---` frontmatter block. Whether an editor sends Markdown or MDX documents
to this server is controlled by that editor's LSP client configuration, so
embedded-frontmatter diagnostics are not available uniformly in every
editor.

The setups below provide diagnostics only. They do not add syntax
highlighting. Standalone `.lima` files are the reliable target; attaching the
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

Zed cannot register an arbitrary custom-language server through user settings
alone. Lima needs a small Zed extension containing `extension.toml`, a language
definition, and Rust code using the `zed_extension_api` crate to return the
language-server command. See Zed's
[language-extension documentation](https://zed.dev/docs/extensions/languages)
and [extension development guide](https://zed.dev/docs/extensions/developing-extensions).

That packaging work is not included in this release. There is currently no
ready-to-use Zed integration or Lima syntax highlighting; once an extension
registers the server, diagnostics can appear as squiggles on otherwise
unhighlighted Lima text.

### Sublime Text

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

The `source.lima` selector requires a `.sublime-syntax` file that associates
`.lima` files with that scope. No such Lima syntax package exists yet, so this
wiring becomes usable only after one is installed. Syntax highlighting is not
available in this release; diagnostics would be squiggles on unhighlighted
text. This release deliberately does not add the missing syntax file.

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
shows the corresponding Server and Mappings tabs. This provides diagnostics;
it does not install Lima-specific syntax highlighting.

### Emacs 29+

Eglot is built into Emacs 29. Add a minimal mode, file association, and server
entry to your Emacs configuration:

```elisp
(define-derived-mode lima-mode fundamental-mode "Lima"
  "Major mode for Lima files.")

(add-to-list 'auto-mode-alist '("\\.lima\\'" . lima-mode))

(with-eval-after-load 'eglot
  (add-to-list 'eglot-server-programs
               '(lima-mode . ("npx"
                              "@limaformat/lima-language-server"
                              "--stdio"))))

(add-hook 'lima-mode-hook #'eglot-ensure)
```

See the GNU Eglot manual's server-setup
[documentation](https://www.gnu.org/software/emacs/manual/html_node/eglot/Setting-Up-LSP-Servers.html).
The fundamental-mode-derived mode supplies the file association needed by
Eglot but no syntax highlighting.

## Configuration

The server accepts these settings through `initializationOptions` or
`workspace/didChangeConfiguration`, nested under `lima.diagnostics`:

- `lima.diagnostics.strict` (default: `true`)
- `lima.diagnostics.ignoreUnresolvedReferences` (default: `true`)

Unresolved document references and partial-related findings are hidden by
default because an editor does not have the caller-provided partials context
used when Lima is parsed at runtime.

This release provides diagnostics only. It does not advertise hover or
go-to-definition capabilities.

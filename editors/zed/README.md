# Lima for Zed

This extension registers `.lima` files with the
[`@limaformat/lima-language-server`](https://www.npmjs.com/package/@limaformat/lima-language-server).
It provides parser diagnostics, hover information for References 2.0 tokens,
and go to definition for resolvable `${document.path}` references. The
extension installs and updates the npm language-server package through Zed,
then starts it over stdio with Zed's Node runtime.

## Install for development

The extension is not published in Zed's extension registry yet. To load this
checkout:

1. Install Rust with `rustup`. Zed installs the required `wasm32-wasip2`
   target and tree-sitter build tooling automatically when possible.
2. In Zed, open the Extensions page, run **Install Dev Extension**, and select
   this `editors/zed` directory.
3. Open a `.lima` file. On first use, Zed downloads the Lima language-server
   npm package into the extension's private working directory.

To compile the WASM component independently of Zed, install its target first:

```sh
rustup target add wasm32-wasip2
cargo build --release --target wasm32-wasip2
```

## Configuration

The extension forwards Zed's `initialization_options` and `settings` for the
`lima-language-server` entry. For example, in Zed settings:

```json
{
  "lsp": {
    "lima-language-server": {
      "initialization_options": {
        "lima": {
          "diagnostics": {
            "strict": false,
            "ignoreUnresolvedReferences": true
          }
        }
      }
    }
  }
}
```

## Syntax highlighting

The extension uses tree-sitter-yaml as the structural grammar required to
register a custom Zed language, but it deliberately does not ship YAML
highlight queries as Lima highlighting. Lima's active References 2.0 tokens,
`^^` markers, block-scalar rules, and escaping semantics need a Lima-aware
grammar or queries. Until those exist, this extension provides LSP features
without claiming accurate syntax highlighting.

Markdown/MDX frontmatter is not registered by this extension. Standalone
`.lima` files are the supported target.

## License

ISC — see [LICENSE](./LICENSE).

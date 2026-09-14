# Lima for JetBrains IDEs

This companion plugin registers
[`@limaformat/lima-language-server`](https://www.npmjs.com/package/@limaformat/lima-language-server)
with [LSP4IJ](https://plugins.jetbrains.com/plugin/23257-lsp4ij) for every
`*.lima` file. No Generic LSP Server entry or file mapping is needed. The
server provides diagnostics, hover information, and go to definition for
resolvable document references.

## Requirements

- IntelliJ IDEA, WebStorm, or another compatible JetBrains IDE based on build
  242 (2024.2) or newer.
- LSP4IJ 0.21.0 or newer. It is declared as a required plugin dependency.
- Node.js with `npx` available in the environment inherited by the IDE.

## Install from this checkout

The plugin is not published to JetBrains Marketplace yet. Build its ZIP:

```sh
./gradlew buildPlugin
```

Then open **Settings | Plugins**, choose **Install Plugin from Disk** from the
gear menu, and select
`build/distributions/lima-jetbrains-0.1.0.zip`. Install LSP4IJ from the
Marketplace first if the IDE does not resolve the required dependency while
sideloading.

Opening a `.lima` file then starts:

```text
npx --yes @limaformat/lima-language-server --stdio
```

The `--yes` flag prevents npm's first-install confirmation from blocking the
language-server process. The npm package is installed in the normal npx cache.

## Syntax highlighting

This is deliberately a thin LSP4IJ companion and does not register an IntelliJ
file type, lexer, or TextMate bundle. Lima-specific syntax highlighting is not
included; depending on other installed file-type support, `.lima` text may be
unhighlighted while LSP diagnostics and navigation remain available.

## Development

Run the unit test and build the installable plugin with:

```sh
./gradlew test buildPlugin
```

LSP4IJ's `server` extension point performs the server registration, while its
`fileNamePatternMapping` maps `*.lima` to the LSP language ID `lima` without
claiming an IntelliJ file type.

## License

ISC — see [LICENSE](./LICENSE).

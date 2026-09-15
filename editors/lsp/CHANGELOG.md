# Changelog

## 0.2.0

- Add standalone `.lima` syntax highlighting for Sublime Text and Emacs.
- Add hover and go-to-definition for `${key}` document references.
- Explain caller-supplied `$(key)` partial references on hover without
  advertising a definition target.
- Fix diagnostic ranges landing before the reported column on lines with
  astral Unicode characters (emoji, rare CJK) preceding the finding.
- Fix Sublime and Emacs recognizing `#` as a comment start only when
  preceded by whitespace; an unescaped `#` now always starts a comment,
  matching Core 1.0 §6.1.4.
- Fix Sublime, TextMate, and Emacs not recognizing a double-quoted key
  containing an escaped quote (`"say \"hi\"": value`).
- Fix the TextMate block-scalar marker (`|`) not being recognized after
  more than one space or a tab following the colon.
- Fix Emacs only highlighting the first element in a dense, comma-packed
  flow sequence (`[10,20]`, `[true,false]`, ...).

## 0.1.0

- Add diagnostics for `.lima` documents.
- Add diagnostics for Lima frontmatter in Markdown and MDX documents when
  those documents are sent by the LSP client.
- Add strict-mode and unresolved-reference diagnostic settings.

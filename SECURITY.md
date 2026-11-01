# Security

## Reporting a vulnerability

Report a vulnerability privately, through GitHub: the repository's **Security** tab, **Report a vulnerability**.
Please do not open a public issue for it. A report is answered within a week; a fix and an advisory follow, crediting
the reporter unless they ask not to be named.

## What Lima guards

A Lima document may come from a source you do not control ([README](README.md), "Security"). In the TypeScript, Rust
and Go implementations:

- parsing runs nothing a document says, and reads nothing but the document and the partials the application passes;
- the resource limits hold in strict and in non-strict mode: a document over a limit stops with `RESOURCE_LIMIT`, and
  resolving references counts what it copies while it copies;
- no input crashes a parser: it ends with a value or an error.

A way around any of these is a vulnerability.

Outside this boundary: what an application does with the values, and the partials it passes, which are trusted like
its code.

## Supported versions

Fixes go into the latest release of each implementation.

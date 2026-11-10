# Lima for front matter

Lima is the part of YAML that front matter needs. If you write front matter in YAML, you already write Lima: the
usual fields read the same. This page shows what you write and names where Lima differs from YAML; the
[guide](guide.md) has every detail, and the [specification](lima-core-1.0-spec.md) is the reference.

## What you write

```yaml
title: A morning in Lisbon
publishFrom: 2026-11-02
draft: false
tags: [travel, photography]
author: $(persons/ada)        # a person the program provides, below
place:
  city: Lisbon
  country: Portugal
gallery:
  - file: harbour.jpg
    caption: The harbour at dawn
  - file: tram.jpg
description: |
  Two lines of text,
  kept as they are.
```

- **A field** is a key, `: ` and its value. A value may hold a colon: `title: Lima: a primer`.
- **A group of fields** is indented under its key, by two spaces.
- **A list** is one `- ` item per line, or `[a, b]` on one line; an item may be a group of fields.
- **Several lines** follow a `|` and are indented under it. A line that begins with `^^` continues the line before it,
  joined by a space.
- **A comment** begins with `#`, on a line of its own or after a value.
- **An empty value** is `null`.

### What a value is

| You write | It is |
| --- | --- |
| `true`, `false` | yes or no |
| `42`, `3.14`, `1e3` | a number |
| `2026-11-02`, `2026-11-02T09:00`, `02.11.2026` | a date, in UTC |
| `null`, `~`, nothing | empty |
| anything else | text |
| `"42"`, `'true'` | text: quotes keep a value as written |

## Where Lima differs from YAML

- **`#` in a value starts a comment**, also inside an address: `https://example.org/page#section` is read as
  `https://example.org/page`. Write `\#`, or put the value in quotes.
- **`yes`, `no`, `on`, `off`, `True` are text**, not yes or no; only `true` and `false` are.
- **`01`, `+42`, `0xFF` are text**, not numbers, so nothing is read as a number that was not meant as one.
- **A date with a time needs the `T`**: `2026-11-02T09:00` is a date, `2026-11-02 09:00` is text.
- **`>` is not there:** a long text is a `|` block, and `^^` joins its lines.
- **Lines are not joined by indentation alone:** a line indented under a value without `|` is an error.
- **No anchors, aliases or tags:** `&name`, `*name` and `!!str` are text. A value used twice is a reference (below).
- **One document:** a `---` line is not part of Lima; the program strips the lines around front matter.
- **A list holds no list**, and `[ ]` or `{ }` nest no deeper than one level.
- **A key may appear once.**

A program may read Lima strictly, as hadley does: then every line Lima cannot place, such as a key without `: `, is an
error with its line number, where a lenient reader would skip it.

## Keys in any language

A key may be written in any script and may hold `-`, `_`, `:`, `*` and `·`: `größe`, `題名`, `og:title`, `autor:in`,
`autor*in`. A key with spaces needs quotes: `"first name": Ada`.

## References

- `$(name)` inserts a value the program provides, such as a person: `author: $(persons/ada)`. Which names exist is the
  program's to say.
- `${key}` inserts another value of the same front matter: `fullName: ${first} ${last}`. On its own, `count: ${total}`
  keeps the type of what it refers to; within text, the result is text.
- In quotes, both are text: `title: "${key}"` stays `${key}`.

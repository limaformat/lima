import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `js/README.md` and `js/CHANGELOG.md` both ship inside the npm tarball on
 * their own (package.json's `files` list is `["dist", "README.md",
 * "LICENSE", "CHANGELOG.md"]` — no `docs/` or `corpus/`), so every link in
 * either must be absolute, not a relative `../docs/...` path that only
 * resolves inside this monorepo checkout.
 *
 * This can't verify the URLs are actually live on GitHub without a network
 * call, but it can verify the *path portion* of every
 * `github.com/limaformat/lima/(blob|tree)/main/<path>` link points at a
 * file that genuinely exists in this checkout — catching the far more
 * likely failure mode: a renamed or deleted doc that a published file
 * forgot to follow.
 */
describe.each(['README.md', 'CHANGELOG.md'])('js/%s links', (filename) => {
	const filePath = join(import.meta.dir, '..', filename)
	const repoRoot = join(import.meta.dir, '..', '..')
	const contents = readFileSync(filePath, 'utf-8')

	const linkPattern = /https:\/\/github\.com\/limaformat\/lima\/(blob|tree)\/main\/([^)\s]+)/g
	const paths = [...contents.matchAll(linkPattern)].map((m) => m[2])

	it('found at least one repository link to check', () => {
		expect(paths.length).toBeGreaterThan(0)
	})

	it.each(paths)('%s exists in this checkout', (path) => {
		expect(existsSync(join(repoRoot, path))).toBe(true)
	})
})

describe('js/README.md links', () => {
	const readme = readFileSync(join(import.meta.dir, '..', 'README.md'), 'utf-8')
	const repoRoot = join(import.meta.dir, '..', '..')

	it('the bare repository link (#readme) resolves to the root README', () => {
		expect(readme).toContain('https://github.com/limaformat/lima#readme')
		expect(existsSync(join(repoRoot, 'README.md'))).toBe(true)
	})
})

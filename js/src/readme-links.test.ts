import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `js/README.md` ships inside the npm tarball on its own (package.json's
 * `files` list is `["dist", "README.md", "LICENSE"]` — no `docs/` or
 * `corpus/`), so every link in it must be absolute, not a relative
 * `../docs/...` path that only resolves inside this monorepo checkout.
 *
 * This can't verify the URLs are actually live on GitHub without a network
 * call, but it can verify the *path portion* of every
 * `github.com/limaformat/lima/(blob|tree)/main/<path>` link points at a
 * file that genuinely exists in this checkout — catching the far more
 * likely failure mode: a renamed or deleted doc that the README forgot to
 * follow.
 */
describe('js/README.md links', () => {
	const readmePath = join(import.meta.dir, '..', 'README.md')
	const repoRoot = join(import.meta.dir, '..', '..')
	const readme = readFileSync(readmePath, 'utf-8')

	const linkPattern = /https:\/\/github\.com\/limaformat\/lima\/(blob|tree)\/main\/([^)\s]+)/g
	const paths = [...readme.matchAll(linkPattern)].map((m) => m[2])

	it('found at least one repository link to check', () => {
		expect(paths.length).toBeGreaterThan(0)
	})

	it.each(paths)('%s exists in this checkout', (path) => {
		expect(existsSync(join(repoRoot, path))).toBe(true)
	})

	it('the bare repository link (#readme) resolves to the root README', () => {
		expect(readme).toContain('https://github.com/limaformat/lima#readme')
		expect(existsSync(join(repoRoot, 'README.md'))).toBe(true)
	})
})

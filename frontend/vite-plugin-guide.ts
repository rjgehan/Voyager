// The user guide (docs/guide/*.md, DESIGN §6.45) as the module `virtual:user-guide`: an object of
// page name → Markdown, which the Help page (src/help/) imports, so the guide is a lazy chunk of the
// build and the app shows the guide of its own version, offline too. The pages stay ordinary
// Markdown files that read on GitHub as they are. A missing guide fails the build (the Dockerfile
// copies docs/guide/ into the frontend stage), rather than shipping an empty Help page.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

export const GUIDE_MODULE = 'virtual:user-guide'
const RESOLVED = '\0' + GUIDE_MODULE

/** Page name → Markdown (LF line breaks) for every `*.md` in `dir`, by name. */
export function readGuide(dir: string): Record<string, string> {
  if (!existsSync(dir)) throw new Error(`The user guide is missing: ${dir} does not exist`)
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
  if (!names.includes('index.md')) throw new Error(`The user guide has no index.md in ${dir}`)
  const pages: Record<string, string> = {}
  for (const name of names) pages[name.slice(0, -3)] = readFileSync(join(dir, name), 'utf8').replace(/\r\n?/g, '\n')
  return pages
}

export function userGuide(dir = fileURLToPath(new URL('../docs/guide', import.meta.url))): Plugin {
  return {
    name: 'notesapp-user-guide',
    resolveId(id) {
      return id === GUIDE_MODULE ? RESOLVED : null
    },
    load(id) {
      if (id !== RESOLVED) return null
      const pages = readGuide(dir)
      for (const name of Object.keys(pages)) this.addWatchFile(join(dir, `${name}.md`))
      return `export default ${JSON.stringify(pages)};\n`
    },
    configureServer(server) {
      // A page added or removed changes the module too (an edit is a watched file already).
      server.watcher.add(dir)
      const changed = (file: string) => {
        if (!file.startsWith(dir) || !file.endsWith('.md')) return
        const mod = server.moduleGraph.getModuleById(RESOLVED)
        if (mod) server.moduleGraph.invalidateModule(mod)
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.on('add', changed)
      server.watcher.on('unlink', changed)
    },
  }
}

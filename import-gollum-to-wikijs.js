const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Client } = require('pg')
const MarkdownIt = require('markdown-it')
const mdAttrs = require('markdown-it-attrs')
const mdDecorate = require('markdown-it-decorate')

const ROOT = '/media/data/wiki'
const LOCALE = 'en'
const AUTHOR_ID = 1
const DRY_RUN = process.env.DRY_RUN === '1'

const md = new MarkdownIt({
  html: false,
  breaks: false,
  linkify: true,
  typographer: true
})
md.use(mdAttrs, { allowedAttributes: ['id', 'class', 'target'] })
md.use(mdDecorate)

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === '.agents' || entry.name === '.codex') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, files)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full)
    }
  }
  return files
}

function titleize(segment) {
  return segment
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function slugify(segment) {
  const normalized = segment
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return normalized || 'page'
}

function relNoExt(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/').replace(/\.md$/i, '')
}

function isImportedDuplicate(rel) {
  return /(^|\/)[^/]*\sImported(?:\s\d+)?$/i.test(rel)
}

function shouldSkip(file) {
  const base = path.basename(file)
  const rel = relNoExt(file)
  if (base === 'AGENTS.md') return 'agent-instructions'
  if (isImportedDuplicate(rel)) return 'imported-duplicate'
  return ''
}

function candidatePath(rel) {
  const parts = rel.split('/')
  if (parts[parts.length - 1].toLowerCase() === 'index') {
    parts.pop()
  }
  if (parts.length === 0) return 'home'
  return parts.map(slugify).join('/')
}

function firstHeading(content) {
  const match = content.match(/^#\s+(.+?)\s*#*\s*$/m)
  return match ? match[1].trim() : ''
}

function sourceTitle(rel, content) {
  const h1 = firstHeading(content)
  if (h1) return h1.slice(0, 255)
  const parts = rel.split('/')
  const leaf = parts[parts.length - 1].toLowerCase() === 'index' && parts.length > 1
    ? parts[parts.length - 2]
    : parts[parts.length - 1]
  return titleize(leaf).slice(0, 255)
}

function normalizeLinkTarget(currentRel, target) {
  const trimmed = target.trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('#')) return null
  const [rawPath, hash = ''] = trimmed.split('#')
  if (!/\.md$/i.test(rawPath)) return null
  const decoded = decodeURIComponent(rawPath)
  const baseDir = path.dirname(currentRel)
  const resolved = path.posix.normalize(path.posix.join(baseDir === '.' ? '' : baseDir, decoded))
  const noExt = resolved.replace(/\.md$/i, '')
  return { noExt, hash: hash ? `#${hash}` : '' }
}

function rewriteLinks(content, currentRel, sourceToWikiPath) {
  return content.replace(/(\[[^\]]+\]\()([^)]+?\.md(?:#[^)]+)?)(\))/g, (full, open, target, close) => {
    const normalized = normalizeLinkTarget(currentRel, target)
    if (!normalized) return full
    const wikiPath = sourceToWikiPath.get(normalized.noExt)
    if (!wikiPath) return full
    return `${open}/${wikiPath}${normalized.hash}${close}`
  })
}

function hashForPath(pagePath) {
  return crypto.createHash('sha1').update(`${LOCALE}|${pagePath}|`).digest('hex')
}

function isoFromFile(file) {
  return fs.statSync(file).mtime.toISOString()
}

function buildPages() {
  const files = walk(ROOT).sort()
  const rawEntries = []
  const skipped = []

  for (const file of files) {
    const rel = relNoExt(file)
    const reason = shouldSkip(file)
    if (reason) {
      skipped.push({ rel, reason })
      continue
    }
    rawEntries.push({
      file,
      rel,
      content: fs.readFileSync(file, 'utf8'),
      candidate: candidatePath(rel),
      isIndex: rel.split('/').pop().toLowerCase() === 'index'
    })
  }

  const byCandidate = new Map()
  for (const entry of rawEntries) {
    const existing = byCandidate.get(entry.candidate)
    if (!existing) {
      byCandidate.set(entry.candidate, entry)
      continue
    }
    if (existing.isIndex && !entry.isIndex) {
      skipped.push({ rel: existing.rel, reason: `index-duplicate-of-${entry.rel}` })
      byCandidate.set(entry.candidate, entry)
    } else if (!existing.isIndex && entry.isIndex) {
      skipped.push({ rel: entry.rel, reason: `index-duplicate-of-${existing.rel}` })
    } else {
      let i = 2
      let next = `${entry.candidate}-${i}`
      while (byCandidate.has(next)) {
        i++
        next = `${entry.candidate}-${i}`
      }
      entry.candidate = next
      byCandidate.set(next, entry)
    }
  }

  const sourceToWikiPath = new Map()
  for (const entry of rawEntries) {
    const kept = byCandidate.get(entry.candidate)
    if (kept === entry) {
      sourceToWikiPath.set(entry.rel, entry.candidate)
    }
  }
  for (const skippedEntry of skipped) {
    const mapped = candidatePath(skippedEntry.rel)
    if (byCandidate.has(mapped)) {
      sourceToWikiPath.set(skippedEntry.rel, mapped)
    }
  }

  const pages = Array.from(byCandidate.values()).map(entry => {
    const rewritten = rewriteLinks(entry.content, entry.rel, sourceToWikiPath)
    const title = sourceTitle(entry.rel, rewritten)
    const rendered = md.render(rewritten)
    return {
      path: entry.candidate,
      hash: hashForPath(entry.candidate),
      title,
      description: '',
      content: rewritten,
      render: rendered,
      toc: '[]',
      createdAt: isoFromFile(entry.file),
      updatedAt: isoFromFile(entry.file),
      sourcePath: entry.rel + '.md'
    }
  }).sort((a, b) => a.path.localeCompare(b.path))

  return { pages, skipped }
}

function buildTree(pages) {
  const tree = []
  let nextId = 0
  for (const page of pages) {
    const parts = page.path.split('/')
    let currentPath = ''
    let parentId = null
    const ancestors = []
    for (let idx = 0; idx < parts.length; idx++) {
      const part = parts[idx]
      const depth = idx + 1
      const isFolder = depth < parts.length
      currentPath = currentPath ? `${currentPath}/${part}` : part
      let found = tree.find(row => row.localeCode === LOCALE && row.path === currentPath)
      if (!found) {
        nextId++
        found = {
          id: nextId,
          localeCode: LOCALE,
          path: currentPath,
          depth,
          title: isFolder ? part : page.title,
          isFolder,
          isPrivate: false,
          privateNS: null,
          parent: parentId,
          pageId: isFolder ? null : page.id,
          ancestors: JSON.stringify(ancestors)
        }
        tree.push(found)
      } else if (isFolder && !found.isFolder) {
        found.isFolder = true
      } else if (!isFolder && found.pageId === null) {
        found.pageId = page.id
        found.title = page.title
      }
      parentId = found.id
      ancestors.push(parentId)
    }
  }
  return tree
}

async function main() {
  const { pages, skipped } = buildPages()
  console.log(`Gollum markdown files selected: ${pages.length}`)
  console.log(`Skipped files: ${skipped.length}`)
  for (const item of skipped.slice(0, 30)) {
    console.log(`  skip ${item.rel}.md (${item.reason})`)
  }
  if (skipped.length > 30) console.log(`  ... ${skipped.length - 30} more skipped`)
  console.log('First 20 target pages:')
  for (const page of pages.slice(0, 20)) {
    console.log(`  ${page.sourcePath} -> /${page.path} (${page.title})`)
  }

  if (DRY_RUN) return

  const client = new Client({
    host: process.env.DB_HOST || 'postgres',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'wikijs',
    user: process.env.DB_USER || 'wikijs',
    password: process.env.DB_PASS
  })
  await client.connect()

  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM "pageHistory" WHERE extra->>'importSource' = 'gollum'`)
    await client.query(`DELETE FROM pages WHERE extra->>'importSource' = 'gollum'`)

    for (const page of pages) {
      const result = await client.query(`
        INSERT INTO pages (
          path, hash, title, description, "isPrivate", "isPublished", "privateNS",
          "publishStartDate", "publishEndDate", content, render, toc, "contentType",
          "createdAt", "updatedAt", "editorKey", "localeCode", "authorId", "creatorId", extra
        )
        VALUES (
          $1, $2, $3, $4, false, true, NULL,
          '', '', $5, $6, $7::json, 'markdown',
          $8, $9, 'markdown', $10, $11, $12, $13::json
        )
        RETURNING id
      `, [
        page.path,
        page.hash,
        page.title,
        page.description,
        page.content,
        page.render,
        page.toc,
        page.createdAt,
        page.updatedAt,
        LOCALE,
        AUTHOR_ID,
        AUTHOR_ID,
        JSON.stringify({ js: '', css: '', importSource: 'gollum', sourcePath: page.sourcePath })
      ])
      page.id = result.rows[0].id

      await client.query(`
        INSERT INTO "pageHistory" (
          path, hash, title, description, "isPrivate", "isPublished",
          "publishStartDate", "publishEndDate", action, "pageId", content, "contentType",
          "createdAt", "editorKey", "localeCode", "authorId", "versionDate", extra
        )
        VALUES (
          $1, $2, $3, $4, false, true,
          '', '', 'created', $5, $6, 'markdown',
          $7, 'markdown', $8, $9, $10, $11::json
        )
      `, [
        page.path,
        page.hash,
        page.title,
        page.description,
        page.id,
        page.content,
        page.createdAt,
        LOCALE,
        AUTHOR_ID,
        page.updatedAt,
        JSON.stringify({ importSource: 'gollum', sourcePath: page.sourcePath })
      ])
    }

    const tree = buildTree(pages)
    await client.query('TRUNCATE "pageTree" CASCADE')
    for (const row of tree) {
      await client.query(`
        INSERT INTO "pageTree" (
          id, path, depth, title, "isPrivate", "isFolder", "privateNS",
          parent, "pageId", "localeCode", ancestors
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::json)
      `, [
        row.id,
        row.path,
        row.depth,
        row.title,
        row.isPrivate,
        row.isFolder,
        row.privateNS,
        row.parent,
        row.pageId,
        row.localeCode,
        row.ancestors
      ])
    }

    await client.query('COMMIT')
    console.log(`Imported ${pages.length} pages and rebuilt ${tree.length} page tree rows.`)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

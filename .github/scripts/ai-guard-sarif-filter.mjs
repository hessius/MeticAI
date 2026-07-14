#!/usr/bin/env node
// ==============================================================================
// AI Guard SARIF baseline filter
// ==============================================================================
// Strips reviewed false-positive results from an ai-guard SARIF file before it
// is uploaded to GitHub Code Scanning, using the declarative allowlist in
// .github/ai-guard-ignore.json. Keeps the AI Guard check actionable (only new,
// genuine findings surface) without making the whole tool blocking.
//
// Usage: node ai-guard-sarif-filter.mjs <sarif-file> [ignore-config]
// Edits the SARIF file in place. No external dependencies.
// ==============================================================================

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const sarifPath = process.argv[2]
const configPath = process.argv[3] || resolve(__dirname, '..', 'ai-guard-ignore.json')

if (!sarifPath) {
  console.error('usage: ai-guard-sarif-filter.mjs <sarif-file> [ignore-config]')
  process.exit(2)
}

/** Convert a simple glob (**, *, ?) into an anchored RegExp over posix paths. */
function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // ** matches across path segments (optionally followed by a slash)
        re += '.*'
        i++
        if (glob[i + 1] === '/') i++
      } else {
        // * matches within a single path segment
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c
    } else {
      re += c
    }
  }
  return new RegExp('^' + re + '$')
}

const config = JSON.parse(readFileSync(configPath, 'utf8'))
const ignorePathRes = (config.ignorePaths || []).map(globToRegExp)
const ignoreRulePaths = (config.ignoreRulePaths || []).map((entry) => ({
  rule: entry.rule,
  re: globToRegExp(entry.path),
}))

const sarif = JSON.parse(readFileSync(sarifPath, 'utf8'))

function resultUri(result) {
  return result?.locations?.[0]?.physicalLocation?.artifactLocation?.uri || ''
}

function isSuppressed(result) {
  const uri = resultUri(result)
  if (ignorePathRes.some((re) => re.test(uri))) return true
  return ignoreRulePaths.some((e) => e.rule === result.ruleId && e.re.test(uri))
}

let removed = 0
let kept = 0
for (const run of sarif.runs || []) {
  if (!Array.isArray(run.results)) continue
  const filtered = run.results.filter((r) => {
    if (isSuppressed(r)) {
      removed++
      return false
    }
    kept++
    return true
  })
  run.results = filtered
}

writeFileSync(sarifPath, JSON.stringify(sarif, null, 2))
console.log(`ai-guard SARIF filter: removed ${removed} suppressed result(s), kept ${kept}.`)

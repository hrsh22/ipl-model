import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "csv-parse/sync"
import { normalizePlayerNameKey } from "./aliases.js"

type CsvScalar = string | number | boolean | null | undefined
type CsvRow = Record<string, CsvScalar>

type GenericRow = Record<string, string>

const rootDir = process.cwd()
const modelDataDir = join(rootDir, "model", "data")
const rawDir = join(modelDataDir, "raw")
const metadataDir = join(modelDataDir, "metadata")
const stagedDir = join(modelDataDir, "staged")

const registerDir = join(rawDir, "cricsheet-register")
const cricketdataDir = join(rawDir, "cricketdata")

const registerPeoplePath = join(registerDir, "people.csv")
const registerNamesPath = join(registerDir, "names.csv")
const playerMetaPath = join(cricketdataDir, "player_meta.csv")

const playerRegistryPath = join(stagedDir, "player_registry.csv")
const outputSourcePath = join(metadataDir, "player_styles.csv")
const outputSourceMapPath = join(stagedDir, "player_style_source_map.csv")
const summaryPath = join(metadataDir, "free_player_style_import_summary.json")

const defaultRegisterReadme = `# Free player-style raw inputs

Place the following free source files here before running the import step:

- \`model/data/raw/cricsheet-register/people.csv\`
- \`model/data/raw/cricsheet-register/names.csv\` (optional but recommended)
- \`model/data/raw/cricketdata/player_meta.csv\`

Expected sources:

- Cricsheet Register \`people.csv\` and \`names.csv\`
- \`cricketdata::player_meta\` exported to CSV
`

const defaultNamesCsv = "id,name\n"

const clean = (value: string | undefined) => value?.trim() ?? ""

const readCsv = (filePath: string) =>
  parse(readFileSync(filePath, "utf-8"), {
    columns: true,
    skip_empty_lines: true,
  }) as GenericRow[]

const csvEscape = (value: CsvScalar): string => {
  if (value === null || value === undefined) {
    return ""
  }

  const stringValue = String(value)
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }

  return stringValue
}

const writeCsv = (filePath: string, headers: string[], rows: CsvRow[]) => {
  const lines = [headers.join(",")]
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(","))
  }
  writeFileSync(filePath, `${lines.join("\n")}\n`, "utf-8")
}

const getValue = (row: GenericRow, candidates: string[]) => {
  for (const candidate of candidates) {
    if (candidate in row && clean(row[candidate])) {
      return clean(row[candidate])
    }
  }

  return ""
}

const sourceKey = (playerName: string, personId: string) => `${personId}::${normalizePlayerNameKey(playerName)}`

const ensureRawPlaceholders = () => {
  mkdirSync(registerDir, { recursive: true })
  mkdirSync(cricketdataDir, { recursive: true })
  mkdirSync(metadataDir, { recursive: true })
  mkdirSync(stagedDir, { recursive: true })

  const readmePath = join(rawDir, "player-style-free-sources.md")
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, defaultRegisterReadme, "utf-8")
  }

  if (!existsSync(registerNamesPath)) {
    writeFileSync(registerNamesPath, defaultNamesCsv, "utf-8")
  }
}

const main = () => {
  ensureRawPlaceholders()

  if (!existsSync(playerRegistryPath)) {
    throw new Error("Missing staged player_registry.csv; run pnpm model:data:prepare first")
  }

  if (!existsSync(playerMetaPath)) {
    writeFileSync(
      summaryPath,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          importedRows: 0,
          missingInputs: {
            playerMeta: !existsSync(playerMetaPath),
            registerPeople: !existsSync(registerPeoplePath),
          },
        },
        null,
        2,
      )}\n`,
      "utf-8",
    )
    console.log("Free player-style raw files are not present yet.")
    console.log(`- expected: ${playerMetaPath}`)
    return
  }

  const playerRegistry = readCsv(playerRegistryPath)
  const registerPeople = existsSync(registerPeoplePath) ? readCsv(registerPeoplePath) : []
  const registerNames = existsSync(registerNamesPath) ? readCsv(registerNamesPath) : []
  const playerMeta = readCsv(playerMetaPath)
  const existingSourceRows = existsSync(outputSourcePath) ? readCsv(outputSourcePath) : []

  const registerById = new Map(
    registerPeople.map((row) => [
      getValue(row, ["identifier", "id"]),
      row,
    ]),
  )

  const registerNamesById = registerNames.reduce<Map<string, Set<string>>>((accumulator, row) => {
    const id = getValue(row, ["id", "identifier", "person_id"])
    const name = getValue(row, ["name", "full_name"])
    if (!id || !name) {
      return accumulator
    }

    const existing = accumulator.get(id) ?? new Set<string>()
    existing.add(name)
    accumulator.set(id, existing)
    return accumulator
  }, new Map())

  const playerMetaByCricsheetId = new Map<string, GenericRow>()
  const playerMetaByCricinfoId = new Map<string, GenericRow>()
  const playerMetaByNameKey = new Map<string, GenericRow[]>()

  for (const row of playerMeta) {
    const cricsheetId = getValue(row, ["cricsheet_id", "identifier"])
    const cricinfoId = getValue(row, ["cricinfo_id", "cricinfoid", "id"])
    const fullName = getValue(row, ["full_name", "name", "unique_name"])
    const nameKey = normalizePlayerNameKey(fullName)

    if (cricsheetId) {
      playerMetaByCricsheetId.set(cricsheetId, row)
    }
    if (cricinfoId) {
      playerMetaByCricinfoId.set(cricinfoId, row)
    }
    if (nameKey) {
      const existing = playerMetaByNameKey.get(nameKey) ?? []
      existing.push(row)
      playerMetaByNameKey.set(nameKey, existing)
    }
  }

  const importedRows: CsvRow[] = []
  const sourceMapRows: CsvRow[] = []

  const existingManualRows = new Map(
    existingSourceRows
      .filter((row) => clean(row.source_name) !== "cricketdata::player_meta")
      .map((row) => [sourceKey(clean(row.player_name), clean(row.cricsheet_person_id)), row]),
  )

  for (const row of playerRegistry) {
    const playerName = getValue(row, ["player_name", "name"])
    const personId = getValue(row, ["person_id", "id"])
    const registerRow = registerById.get(personId)

    let matchedMeta: GenericRow | undefined
    let matchStrategy = "unmatched"
    let matchConfidence = "none"
    const existingManualRow = existingManualRows.get(sourceKey(playerName, personId))

    matchedMeta = playerMetaByCricsheetId.get(personId)
    if (matchedMeta) {
      matchStrategy = "cricsheet_id"
      matchConfidence = "high"
    }

    if (registerRow) {
      if (!matchedMeta) {
        const cricinfoId = getValue(registerRow, ["key_cricinfo", "key_cricinfo_2"])
        if (cricinfoId) {
          matchedMeta = playerMetaByCricinfoId.get(cricinfoId)
          if (matchedMeta) {
            matchStrategy = "cricinfo_id"
            matchConfidence = "high"
          }
        }
      }

      if (!matchedMeta) {
        const candidates = [
          playerName,
          getValue(registerRow, ["name", "unique_name"]),
          ...Array.from(registerNamesById.get(personId) ?? []),
        ]
          .map((value) => normalizePlayerNameKey(value))
          .filter(Boolean)

        for (const nameKey of candidates) {
          const matches = playerMetaByNameKey.get(nameKey)
          if (matches?.length === 1) {
            matchedMeta = matches[0]
            matchStrategy = "normalized_name"
            matchConfidence = "medium"
            break
          }
        }
      }
    }

    if (!matchedMeta && existingManualRow) {
      matchStrategy = `existing_${clean(existingManualRow.source_name) || "manual"}`
      matchConfidence = clean(existingManualRow.needs_manual_review).toLowerCase() === "true" ? "manual_review" : "manual"
    }

    const matchedPlayerName = matchedMeta ? getValue(matchedMeta, ["full_name", "name", "unique_name"]) : ""
    sourceMapRows.push({
      player_name: playerName,
      cricsheet_person_id: personId,
      source_name: matchedMeta ? "cricketdata::player_meta" : clean(existingManualRow?.source_name),
      source_player_id: matchedMeta ? getValue(matchedMeta, ["cricinfo_id", "cricinfoid", "id"]) : clean(existingManualRow?.source_player_id),
      source_full_name: matchedPlayerName || clean(existingManualRow?.player_name),
      match_strategy: matchStrategy,
      match_confidence: matchConfidence,
      needs_manual_review:
        matchConfidence === "none" ||
        matchConfidence === "medium" ||
        matchConfidence === "manual_review",
    })

    if (!matchedMeta) {
      continue
    }

    importedRows.push({
      player_name: playerName,
      cricsheet_person_id: personId,
      source_name: "cricketdata::player_meta",
      source_player_id: getValue(matchedMeta, ["cricinfo_id", "cricinfoid", "id"]),
      batting_style_raw: getValue(matchedMeta, ["batting_style", "battingStyle"]),
      bowling_style_raw: getValue(matchedMeta, ["bowling_style", "bowlingStyle"]),
      identified_roles_raw: getValue(matchedMeta, ["playing_role", "role"]),
      playing_role_raw: getValue(matchedMeta, ["playing_role", "role"]),
      needs_manual_review: matchConfidence === "medium",
      notes: matchStrategy,
    })
  }

  const mergedRows = new Map<string, CsvRow>()

  for (const row of importedRows) {
    mergedRows.set(sourceKey(String(row.player_name), String(row.cricsheet_person_id)), row)
  }

  for (const row of existingManualRows.values()) {
    mergedRows.set(sourceKey(clean(row.player_name), clean(row.cricsheet_person_id)), row)
  }

  const finalRows = Array.from(mergedRows.values()).sort((left, right) =>
    String(left.player_name).localeCompare(String(right.player_name)),
  )

  writeCsv(
    outputSourcePath,
    [
      "player_name",
      "cricsheet_person_id",
      "source_name",
      "source_player_id",
      "batting_style_raw",
      "bowling_style_raw",
      "identified_roles_raw",
      "playing_role_raw",
      "needs_manual_review",
      "notes",
    ],
    finalRows,
  )

  writeCsv(
    outputSourceMapPath,
    [
      "player_name",
      "cricsheet_person_id",
      "source_name",
      "source_player_id",
      "source_full_name",
      "match_strategy",
      "match_confidence",
      "needs_manual_review",
    ],
    sourceMapRows,
  )

  writeFileSync(
    summaryPath,
    `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          importedRows: importedRows.length,
          finalRows: finalRows.length,
          sourceMapRows: sourceMapRows.length,
          registerPeopleRows: registerPeople.length,
          playerMetaRows: playerMeta.length,
        matchStrategies: sourceMapRows.reduce<Record<string, number>>((acc, currentRow) => {
          const strategy = String(currentRow.match_strategy)
          acc[strategy] = (acc[strategy] ?? 0) + 1
          return acc
        }, {}),
      },
      null,
      2,
    )}\n`,
    "utf-8",
  )

  console.log("Imported free player-style metadata:")
  console.log(`- imported rows: ${importedRows.length}`)
  console.log(`- source map rows: ${sourceMapRows.length}`)
}

main()

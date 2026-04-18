import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "csv-parse/sync"
import { normalizePlayerNameKey } from "./aliases.js"

type CsvScalar = string | number | boolean | null | undefined
type CsvRow = Record<string, CsvScalar>

const rootDir = process.cwd()
const modelDataDir = join(rootDir, "model", "data")
const metadataDir = join(modelDataDir, "metadata")
const stagedDir = join(modelDataDir, "staged")

const sourcePath = join(metadataDir, "player_styles.csv")
const overridePath = join(metadataDir, "player_style_overrides.csv")
const outputPath = join(stagedDir, "player_style_profiles.csv")

const defaultSourceCsv = `player_name,cricsheet_person_id,source_name,source_player_id,batting_style_raw,bowling_style_raw,identified_roles_raw,playing_role_raw,needs_manual_review,notes
`

const defaultOverrideCsv = `player_name,cricsheet_person_id,override_bowling_style_canonical,override_bowling_style_family,override_role_canonical,notes
`

const clean = (value: string | undefined) => value?.trim() ?? ""

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

const readCsv = (filePath: string) =>
  parse(readFileSync(filePath, "utf-8"), {
    columns: true,
    skip_empty_lines: true,
  }) as Array<Record<string, string>>

const canonicalizeRole = (identifiedRolesRaw: string, playingRoleRaw: string) => {
  const combined = `${identifiedRolesRaw} ${playingRoleRaw}`
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (combined.includes("wk batter") || combined.includes("wk batsman")) return "keeper_batter"
  if (combined.includes("wicketkeeper batter")) return "keeper_batter"
  if (combined.includes("keeper")) return "keeper"
  if (combined.includes("batting allrounder")) return "batting_all_rounder"
  if (combined.includes("bowling allrounder")) return "bowling_all_rounder"
  if (combined.includes("allround")) return "all_rounder"
  if (combined.includes("bowler")) return "bowler"
  if (combined.includes("batsman") || combined.includes("batter")) return "batter"
  return "unknown"
}

const classifyBowlingStyle = (bowlingStyleRaw: string) => {
  const normalized = bowlingStyleRaw.toLowerCase()
  if (!normalized || normalized === "none" || normalized === "na") {
    return { canonical: "unknown", family: "unknown" }
  }

  if (
    normalized.includes("offbreak") ||
    normalized.includes("orthodox") ||
    normalized.includes("legbreak") ||
    normalized.includes("googly") ||
    normalized.includes("chinaman") ||
    normalized.includes("wrist spin") ||
    normalized.includes("slow left-arm") ||
    normalized.includes("slow right-arm") ||
    normalized.includes("spin")
  ) {
    return { canonical: bowlingStyleRaw, family: "spin" }
  }

  if (
    normalized.includes("fast") ||
    normalized.includes("medium") ||
    normalized.includes("seam")
  ) {
    return { canonical: bowlingStyleRaw, family: "pace" }
  }

  return { canonical: bowlingStyleRaw, family: "unknown" }
}

const main = () => {
  mkdirSync(metadataDir, { recursive: true })
  mkdirSync(stagedDir, { recursive: true })

  if (!existsSync(sourcePath)) {
    writeFileSync(sourcePath, defaultSourceCsv, "utf-8")
  }

  if (!existsSync(overridePath)) {
    writeFileSync(overridePath, defaultOverrideCsv, "utf-8")
  }

  const sourceRows = readCsv(sourcePath)
  const overrideRows = readCsv(overridePath)
  const overrides = new Map(
    overrideRows.map((row) => [
      `${clean(row.cricsheet_person_id)}::${normalizePlayerNameKey(clean(row.player_name))}`,
      row,
    ]),
  )

  const outputRows = sourceRows.map((row) => {
    const playerName = clean(row.player_name)
    const personId = clean(row.cricsheet_person_id)
    const key = `${personId}::${normalizePlayerNameKey(playerName)}`
    const override = overrides.get(key)
    const battingStyleRaw = clean(row.batting_style_raw)
    const bowlingStyleRaw = clean(row.bowling_style_raw)
    const identifiedRolesRaw = clean(row.identified_roles_raw)
    const playingRoleRaw = clean(row.playing_role_raw)
    const classified = classifyBowlingStyle(bowlingStyleRaw)

    return {
      player_name: playerName,
      player_name_key: normalizePlayerNameKey(playerName),
      cricsheet_person_id: personId,
      source_name: clean(row.source_name),
      source_player_id: clean(row.source_player_id),
      batting_style_raw: battingStyleRaw,
      bowling_style_raw: bowlingStyleRaw,
      identified_roles_raw: identifiedRolesRaw,
      playing_role_raw: playingRoleRaw,
      batting_hand: battingStyleRaw.toLowerCase().includes("left") ? "left" : battingStyleRaw ? "right" : "unknown",
      bowling_style_canonical: clean(override?.override_bowling_style_canonical) || classified.canonical,
      bowling_style_family: clean(override?.override_bowling_style_family) || classified.family,
      role_canonical: clean(override?.override_role_canonical) || canonicalizeRole(identifiedRolesRaw, playingRoleRaw),
      is_keeper: /keeper/i.test(`${identifiedRolesRaw} ${playingRoleRaw}`),
      is_bowling_option: classified.family !== "unknown",
      is_spin_option: (clean(override?.override_bowling_style_family) || classified.family) === "spin",
      is_pace_option: (clean(override?.override_bowling_style_family) || classified.family) === "pace",
      needs_manual_review: clean(row.needs_manual_review) || (classified.family === "unknown" ? "true" : "false"),
      notes: clean(row.notes) || clean(override?.notes),
    }
  })

  writeCsv(
    outputPath,
    [
      "player_name",
      "player_name_key",
      "cricsheet_person_id",
      "source_name",
      "source_player_id",
      "batting_style_raw",
      "bowling_style_raw",
      "identified_roles_raw",
      "playing_role_raw",
      "batting_hand",
      "bowling_style_canonical",
      "bowling_style_family",
      "role_canonical",
      "is_keeper",
      "is_bowling_option",
      "is_spin_option",
      "is_pace_option",
      "needs_manual_review",
      "notes",
    ],
    outputRows,
  )

  writeFileSync(
    join(metadataDir, "player_style_summary.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sourceRows: sourceRows.length,
        outputRows: outputRows.length,
        byFamily: outputRows.reduce<Record<string, number>>((acc, row) => {
          const family = String(row.bowling_style_family)
          acc[family] = (acc[family] ?? 0) + 1
          return acc
        }, {}),
      },
      null,
      2,
    )}\n`,
    "utf-8",
  )

  console.log("Prepared staged player style profiles:")
  console.log(`- source rows: ${sourceRows.length}`)
  console.log(`- output rows: ${outputRows.length}`)
}

main()

import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parse } from "csv-parse/sync"

type CsvScalar = string | number | boolean | null | undefined
type CsvRow = Record<string, CsvScalar>

const rootDir = process.cwd()
const modelDataDir = join(rootDir, "model", "data")
const featuresDir = join(modelDataDir, "features")
const matricesDir = join(modelDataDir, "matrices")
const metadataDir = join(modelDataDir, "metadata")

const preTossSourcePath = join(featuresDir, "training_ready_matchup_features.csv")
const postTossSourcePath = join(featuresDir, "training_ready_post_toss_matchup_features.csv")

const preTossMatrixPath = join(matricesDir, "pre_toss_model_matrix.csv")
const postTossMatrixPath = join(matricesDir, "post_toss_model_matrix.csv")
const manifestPath = join(metadataDir, "model_matrix_manifest.json")

const readCsv = (filePath: string) =>
  parse(readFileSync(filePath, "utf-8"), {
    columns: true,
    skip_empty_lines: true,
  }) as Array<Record<string, string>>

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

const sha256 = (filePath: string) =>
  createHash("sha256").update(readFileSync(filePath)).digest("hex")

const metadataColumns = ["match_id", "season", "match_date"]
const excludedColumns = ["training_eligible", "training_exclusion_reasons"]
const categoricalColumns = ["venue", "city", "home_team", "team1", "team2", "toss_winner", "toss_decision"]
const targetColumn = "target_team1_won"

const buildMatrix = (sourcePath: string, matrixPath: string) => {
  const rows = readCsv(sourcePath)
  const sourceHeaders = Object.keys(rows[0] ?? {})
  const featureColumns = sourceHeaders.filter(
    (column) => !metadataColumns.includes(column) && !excludedColumns.includes(column) && column !== "team1_won",
  )

  const matrixHeaders = [...metadataColumns, targetColumn, ...featureColumns]
  const matrixRows = rows.map<CsvRow>((row) => {
    const base: CsvRow = {
      match_id: row.match_id,
      season: row.season,
      match_date: row.match_date,
      [targetColumn]: row.team1_won,
    }

    for (const column of featureColumns) {
      base[column] = row[column]
    }

    return base
  })

  writeCsv(matrixPath, matrixHeaders, matrixRows)

  const seasonCounts = matrixRows.reduce<Record<string, number>>((accumulator, row) => {
    const season = String(row.season)
    accumulator[season] = (accumulator[season] ?? 0) + 1
    return accumulator
  }, {})

  return {
    rows: matrixRows.length,
    columns: matrixHeaders.length,
    sourcePath,
    matrixPath,
    sourceSha256: sha256(sourcePath),
    matrixSha256: sha256(matrixPath),
    metadataColumns,
    targetColumn,
    featureColumns,
    categoricalFeatureColumns: featureColumns.filter((column) => categoricalColumns.includes(column)),
    numericOrBinaryFeatureColumns: featureColumns.filter((column) => !categoricalColumns.includes(column)),
    availableSeasons: Object.keys(seasonCounts).map(Number).sort((left, right) => left - right),
    seasonCounts,
  }
}

const main = () => {
  mkdirSync(matricesDir, { recursive: true })
  mkdirSync(metadataDir, { recursive: true })

  const preToss = buildMatrix(preTossSourcePath, preTossMatrixPath)
  const postToss = buildMatrix(postTossSourcePath, postTossMatrixPath)

  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note: "Frozen model-matrix layer built from training-ready feature datasets. Excluded seasons are already removed upstream by training eligibility rules.",
        preToss,
        postToss,
      },
      null,
      2,
    )}\n`,
    "utf-8",
  )

  console.log("Built frozen model matrices:")
  console.log(`- pre-toss rows: ${preToss.rows}, columns: ${preToss.columns}`)
  console.log(`- post-toss rows: ${postToss.rows}, columns: ${postToss.columns}`)
}

main()

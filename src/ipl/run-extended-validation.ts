import { validateExtended } from "./extended-validation.js"

const dataDir = process.env.DATA_DIR || "./data/cricsheet"
validateExtended(dataDir).catch((error) => {
  console.error("Validation failed:", error)
  process.exit(1)
})

/**
 * Validation Runner
 * Entry point for Phase 1 validation
 */

import { validatePhase1 } from "./phase1-validation.js"

const dataDir = process.env.DATA_DIR || "./data/cricsheet"

validatePhase1(dataDir).catch((error) => {
  console.error("Validation failed:", error)
  process.exit(1)
})

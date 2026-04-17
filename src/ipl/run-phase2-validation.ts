/**
 * Runner for Phase 2 Validation
 */

import { validatePhase2 } from "./phase2-validation.js"

validatePhase2("./data/cricsheet").catch((error) => {
  console.error("Validation failed:", error)
  process.exit(1)
})

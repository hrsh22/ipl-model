import { runDiagnostics } from "./diagnostic.js"

const dataDir = process.env.DATA_DIR || "./data/cricsheet"
runDiagnostics(dataDir)

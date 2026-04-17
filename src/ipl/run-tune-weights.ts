import { tuneWeights } from "./tune-weights.js"

const dataDir = process.env.DATA_DIR || "./data/cricsheet"
tuneWeights(dataDir)

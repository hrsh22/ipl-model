export type TradingSide = "buy" | "sell"
export type TradingOrderStyle = "limit" | "market"

export const TRADING_BALANCE_ALLOCATION_FRACTION = 0.2
export const POLYMARKET_CLOB_HOST = "https://clob.polymarket.com"
export const POLYMARKET_CHAIN_ID = 137

export interface TradingRecipeInput {
  marketId?: string | null
  conditionId?: string | null
  tokenId?: string | null
  side?: TradingSide | null
  orderStyle?: TradingOrderStyle | null
  maxPrice?: number | null
  expiryEpochMs?: number | null
  context?: Record<string, unknown> | null
}

export interface ValidatedTradingRecipe {
  marketId: string
  conditionId: string
  tokenId: string
  side: TradingSide
  orderStyle: TradingOrderStyle
  maxPrice: number
  expiryEpochMs: number
  context?: Record<string, unknown> | null
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] }

export type TradingReadinessReasonCode =
  | "ENV_LIVE_GATE_DISABLED"
  | "DB_RUNTIME_LIVE_GATE_DISABLED"
  | "POLYMARKET_CREDENTIALS_MISSING"
  | "RECIPE_MISSING"
  | "RECIPE_INVALID"

export interface TradingReadinessReason {
  code: TradingReadinessReasonCode
  errors?: string[]
}

export type TradingReadinessResult =
  | {
      liveReady: true
      mode: "live"
      recipe: ValidatedTradingRecipe
      reasons: []
    }
  | {
      liveReady: false
      mode: "dry-run"
      reasons: TradingReadinessReason[]
    }

const nonEmptyString = (value: string | null | undefined) => value?.trim() ?? ""

const validatePositiveNumber = (
  value: number | null | undefined,
  fieldName: string,
  errors: string[],
) => {
  if (value == null) {
    errors.push(`${fieldName} is required`)
    return null
  }

  if (!Number.isFinite(value) || value <= 0) {
    errors.push(`${fieldName} must be a positive number`)
    return null
  }

  return value
}

export const validateTradingRecipe = (
  recipe: TradingRecipeInput | null | undefined,
): ValidationResult<ValidatedTradingRecipe> => {
  if (!recipe) {
    return { ok: false, errors: ["recipe is required"] }
  }

  const errors: string[] = []
  const marketId = nonEmptyString(recipe.marketId)
  const conditionId = nonEmptyString(recipe.conditionId)
  const tokenId = nonEmptyString(recipe.tokenId)

  if (!marketId) {
    errors.push("marketId is required")
  }

  if (!conditionId) {
    errors.push("conditionId is required")
  }

  if (!tokenId) {
    errors.push("tokenId is required")
  }

  if (recipe.side !== "buy" && recipe.side !== "sell") {
    errors.push("side is required")
  }

  if (recipe.orderStyle !== "limit" && recipe.orderStyle !== "market") {
    errors.push("orderStyle is required")
  }

  const maxPrice = validatePositiveNumber(recipe.maxPrice, "maxPrice", errors)
  if (maxPrice != null && maxPrice > 1) {
    errors.push("maxPrice must be less than or equal to 1")
  }

  const expiryEpochMs = validatePositiveNumber(recipe.expiryEpochMs, "expiryEpochMs", errors)
  if (expiryEpochMs != null && !Number.isInteger(expiryEpochMs)) {
    errors.push("expiryEpochMs must be a positive integer")
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const validatedMaxPrice = maxPrice as number

  return {
    ok: true,
    value: {
      marketId,
      conditionId,
      tokenId,
      side: recipe.side as TradingSide,
      orderStyle: recipe.orderStyle as TradingOrderStyle,
      maxPrice: validatedMaxPrice,
      expiryEpochMs: expiryEpochMs as number,
      context: recipe.context ?? null,
    },
  }
}

export interface TradingLiveReadinessInput {
  liveTradingEnabled: boolean
  runtimeTradingEnabled: boolean
  credentialsPresent: boolean
  recipe: ValidationResult<ValidatedTradingRecipe> | ValidatedTradingRecipe | null
}

export const assessTradingLiveReadiness = (
  input: TradingLiveReadinessInput,
): TradingReadinessResult => {
  const reasons: TradingReadinessReason[] = []
  let validatedRecipe: ValidatedTradingRecipe | null = null

  if (!input.liveTradingEnabled) {
    reasons.push({ code: "ENV_LIVE_GATE_DISABLED" })
  }

  if (!input.runtimeTradingEnabled) {
    reasons.push({ code: "DB_RUNTIME_LIVE_GATE_DISABLED" })
  }

  if (!input.credentialsPresent) {
    reasons.push({ code: "POLYMARKET_CREDENTIALS_MISSING" })
  }

  if (!input.recipe) {
    reasons.push({ code: "RECIPE_MISSING" })
  } else if ("ok" in input.recipe) {
    if (!input.recipe.ok) {
      reasons.push({ code: "RECIPE_INVALID", errors: input.recipe.errors })
    } else {
      validatedRecipe = input.recipe.value
    }
  } else {
    validatedRecipe = input.recipe
  }

  if (reasons.length > 0) {
    return {
      liveReady: false,
      mode: "dry-run",
      reasons,
    }
  }

  if (!validatedRecipe) {
    return {
      liveReady: false,
      mode: "dry-run",
      reasons: [{ code: "RECIPE_MISSING" }],
    }
  }

  return {
    liveReady: true,
    mode: "live",
    recipe: validatedRecipe,
    reasons: [],
  }
}

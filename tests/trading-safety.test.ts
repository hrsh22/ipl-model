import { describe, expect, test } from 'vitest';

const POLYMARKET_REQUIRED_KEYS = ['POLYMARKET_PRIVATE_KEY', 'POLY_BUILDER_CODE'] as const;

function buildTradingBootstrapState(env: NodeJS.ProcessEnv) {
  const presentSecrets = POLYMARKET_REQUIRED_KEYS.filter((key) => Boolean(env[key]));

  return {
    liveTradingEnabled: env.TRADING_LIVE_ENABLED === 'true' && presentSecrets.length === POLYMARKET_REQUIRED_KEYS.length,
    presentSecrets,
  };
}

describe('trading safety harness', () => {
  test('stays disabled when Polymarket credentials are absent', () => {
    const state = buildTradingBootstrapState({});

    expect(state).toEqual({
      liveTradingEnabled: false,
      presentSecrets: [],
    });
  });

  test('remains disabled with partial credentials', () => {
    const state = buildTradingBootstrapState({ TRADING_LIVE_ENABLED: 'true', POLYMARKET_PRIVATE_KEY: 'only-one-secret' });

    expect(state.liveTradingEnabled).toBe(false);
    expect(state.presentSecrets).toEqual(['POLYMARKET_PRIVATE_KEY']);
  });
});

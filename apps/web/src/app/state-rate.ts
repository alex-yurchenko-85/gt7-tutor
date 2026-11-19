import { DEFAULT_STATE_RATE, STATE_RATES, type StateRate } from '@gt7/contracts';
import { readStored, writeStored } from './storage.ts';

const STATE_RATE_KEY = 'gt7.stateRate';

function isStateRate(value: number): value is StateRate {
  return STATE_RATES.some(rate => rate === value);
}

export function stateRate(): StateRate {
  const stored = Number(readStored(STATE_RATE_KEY));
  return isStateRate(stored) ? stored : DEFAULT_STATE_RATE;
}

export function setStateRate(rate: StateRate): void {
  writeStored(STATE_RATE_KEY, String(rate));
}

import { STATE_RATES, type StateRate } from '@gt7/contracts';

const STATE_RATE_KEY = 'gt7.stateRate';
const DEFAULT_RATE: StateRate = 15;

function isStateRate(value: number): value is StateRate {
  return STATE_RATES.some(rate => rate === value);
}

export function stateRate(): StateRate {
  try {
    const stored = Number(window.localStorage.getItem(STATE_RATE_KEY));
    return isStateRate(stored) ? stored : DEFAULT_RATE;
  } catch {
    return DEFAULT_RATE;
  }
}

export function setStateRate(rate: StateRate): void {
  try {
    window.localStorage.setItem(STATE_RATE_KEY, String(rate));
  } catch {
    return;
  }
}

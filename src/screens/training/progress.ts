/** First-run progress on this device (no server state): training finished, first delivery played. */
const TRAINED = 'vc:trained';
const FIRST_DELIVERY = 'vc:first-delivery';

export function hasTrained(): boolean {
  try {
    return localStorage.getItem(TRAINED) === '1';
  } catch {
    return false;
  }
}

export function markTrained(): void {
  try {
    localStorage.setItem(TRAINED, '1');
  } catch {
    /* storage unavailable */
  }
}

/** True the first time only. */
export function markFirstDelivery(): boolean {
  try {
    if (localStorage.getItem(FIRST_DELIVERY) === '1') return false;
    localStorage.setItem(FIRST_DELIVERY, '1');
    return true;
  } catch {
    return false;
  }
}

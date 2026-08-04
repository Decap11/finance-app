/**
 * What a shares contribution IS — expressed once.
 *
 * A shares contribution is a WHOLE NUMBER OF SHARES bought at the SACCO's share price.
 * The money is a consequence of those two facts, not a fact in its own right.
 *
 * The app used to hold only the consequence. `transactions.amount` was written as
 * `count * price`, the count was never stored, and the price was resolved separately by
 * every party involved:
 *
 *   - the member's browser, from a `localStorage` cache shared by every group that had
 *     ever signed in on that device, falling back to a hardcoded 25,000;
 *   - the API, from the database, falling back to a hardcoded 25,000 whenever the settings
 *     read failed or the group had no row;
 *   - the admin's report and the contribution heatmap, by dividing the stored amount by
 *     whatever the price happens to be TODAY.
 *
 * So one member's single request could be four different numbers, and an admin editing the
 * share price silently rewrote how many shares every member had ever bought. That is the
 * whole of the bug: nothing was wrong with the arithmetic anywhere, and no two places were
 * doing it from the same inputs.
 *
 * The rule now is that the server resolves the price, the member's screen must agree with
 * it before a submission is accepted, and BOTH the count and the price actually charged are
 * stored on the row. Nothing downstream divides to get a count back.
 */

/**
 * The price a SACCO gets before anybody has set one, matching
 * `SACCO_DEFAULTS.sharePrice` in `src/app/api/sacco-settings/route.js`.
 *
 * Exported so that no screen invents its own — `UserProgressTracker` used 5,000 while
 * everything else used 25,000, and it silently sized every member's shares target at a
 * fifth of what the contribution form was charging them.
 *
 * It is a fallback for DISPLAY only. Nothing may write money using it: see
 * `resolveShareUnitPrice`.
 */
export const DEFAULT_SHARE_PRICE = 25000;

/** A member may buy between one and ten shares in a week. */
export const SHARE_QTY_MIN = 1;
export const SHARE_QTY_MAX = 10;

/**
 * Did this submission ask for shares at all?
 *
 * Blank and zero both mean "not buying shares this week", which is allowed — the member may
 * be contributing only to the development or social fund. Everything else is an attempt to
 * buy shares and must survive `parseShareQuantity`, including the values that used to be
 * dropped in silence (a negative, or 2.5).
 */
export function wantsShares(raw) {
  if (raw === undefined || raw === null) return false;
  const text = String(raw).trim();
  if (text === '') return false;
  return Number(text) !== 0;
}

/**
 * A share quantity, or the reason it is not one.
 *
 * Whole numbers only. A fraction is the one input that breaks the invariant this file
 * exists to hold — 2.5 shares at 25,000 is 62,500, which is not a multiple of the share
 * price and cannot be read back as a number of shares by anything.
 *
 * @returns {{ok: true, quantity: number} | {ok: false, error: string}}
 */
export function parseShareQuantity(raw) {
  const quantity = Number(raw);

  if (!Number.isFinite(quantity)) {
    return { ok: false, error: 'Enter the number of shares as a plain number.' };
  }

  if (!Number.isInteger(quantity)) {
    return { ok: false, error: 'Shares are bought whole. Enter a whole number, not a fraction.' };
  }

  if (quantity < SHARE_QTY_MIN || quantity > SHARE_QTY_MAX) {
    return {
      ok: false,
      error: `You can buy between ${SHARE_QTY_MIN} and ${SHARE_QTY_MAX} shares in a week.`
    };
  }

  return { ok: true, quantity };
}

/**
 * The price to charge, or the reason there is none.
 *
 * The old code opened with `let sharePrice = 25000` and then tried to improve on it inside a
 * `try` that swallowed its own failure, so a settings read that broke charged every member
 * 25,000 a share and told nobody. A SACCO whose share price is 5,000 would have had its
 * members' contributions recorded at five times what their screens said.
 *
 * There is no safe guess here. A price that cannot be established is a refusal.
 *
 * `isDefault` is set by `getActiveSaccoSettings` when no row matched the group code, i.e.
 * the figures describe nobody. Trusting them would charge a real member a made-up price.
 *
 * @returns {{ok: true, unitPrice: number} | {ok: false, error: string}}
 */
export function resolveShareUnitPrice(settings) {
  if (!settings) {
    return {
      ok: false,
      error: 'Could not read your SACCO settings, so the share price is unknown. '
        + 'Nothing was recorded — try again in a moment.'
    };
  }

  if (settings.isDefault) {
    return {
      ok: false,
      error: 'Your SACCO has no share price configured yet. '
        + 'Ask your admin to set it in Configuration Settings before buying shares.'
    };
  }

  const unitPrice = Number(settings.sharePrice);

  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    return {
      ok: false,
      error: 'Your SACCO\'s share price is not a usable amount. '
        + 'Ask your admin to correct it in Configuration Settings.'
    };
  }

  return { ok: true, unitPrice };
}

/**
 * The money for a quantity of shares. The only place this multiplication happens.
 */
export function shareContributionAmount(quantity, unitPrice) {
  return Number(quantity) * Number(unitPrice);
}

/**
 * Does the price the member was looking at match the price they will be charged?
 *
 * The member's screen renders a total before they press Contribute. If the admin changes
 * the share price in between — or the browser was showing a cached price belonging to a
 * different group, or one from before the settings finished loading — then the figure they
 * agreed to is not the figure that would be stored. That request must fail, not round-trip
 * silently at the new price.
 *
 * @returns {string|null} null when they agree; the disagreement, phrased for the member, when they do not.
 */
export function sharePriceDisagreement(shownPrice, chargedPrice) {
  const shown = Number(shownPrice);

  if (!Number.isFinite(shown) || shown <= 0) {
    return 'Your screen could not confirm the share price. Refresh the page and try again.';
  }

  if (shown === Number(chargedPrice)) return null;

  return `The share price is now Shs ${formatShs(chargedPrice)}, not the Shs ${formatShs(shown)} `
    + 'your screen was showing. Nothing was recorded — check the new total and submit again.';
}

/**
 * `1,500` — always in this format, whoever is formatting it.
 *
 * Pinned to en-US rather than the machine's locale because this goes into
 * `transactions.description`, which is stored, later read back by `parseShareDescription`,
 * and on the server is formatted by whatever locale the deployment happens to run under. A
 * description written as "25.000" and parsed as twenty-five is the same class of fault as
 * the one this file exists to close.
 */
export function formatShs(value) {
  return Number(value || 0).toLocaleString('en-US');
}

/** The ledger line for a shares request. Parsed back by `parseShareDescription`. */
export function describeShareRequest(quantity, unitPrice, week) {
  return `Contribution request: ${quantity} share(s) @ Shs ${formatShs(unitPrice)} | Week ${week}`;
}

/**
 * The count and price out of a legacy row's description.
 *
 * Rows written before `share_count` / `unit_price` existed carry both facts in prose, which
 * is the only record of what was actually agreed at the time. Migration 0033 promotes what
 * it can into the columns; this covers whatever it could not, and rows written by an older
 * deployment still running.
 *
 * @returns {{quantity: number, unitPrice: number} | null}
 */
export function parseShareDescription(description) {
  if (!description) return null;

  const match = String(description).match(/([\d,]+)\s*share\(s\)\s*@\s*Shs\s*([\d,]+)/i);
  if (!match) return null;

  const quantity = Number(match[1].replace(/,/g, ''));
  const unitPrice = Number(match[2].replace(/,/g, ''));

  if (!Number.isInteger(quantity) || quantity <= 0) return null;
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;

  return { quantity, unitPrice };
}

/**
 * How many shares a transaction row represents.
 *
 * In precedence order: what was stored at the time, what the description recorded at the
 * time, and only then — for rows that predate both, or that an admin backfilled as a plain
 * amount — the old division by today's price.
 *
 * That last step is a guess and is why the columns exist. It is kept so historical rows
 * still show a number rather than a blank, and it is deliberately last.
 */
export function shareCountOf(tx, fallbackUnitPrice = DEFAULT_SHARE_PRICE) {
  if (!tx) return 0;

  const stored = Number(tx.share_count);
  if (Number.isInteger(stored) && stored > 0) return stored;

  const described = parseShareDescription(tx.description);
  if (described) return described.quantity;

  const price = Number(fallbackUnitPrice) || DEFAULT_SHARE_PRICE;
  if (price <= 0) return 0;

  return Math.round((Number(tx.amount) || 0) / price);
}

/**
 * The price a transaction row was actually charged at, or null when the row never said.
 *
 * Null matters: it is the difference between "this member paid 5,000 a share" and "nobody
 * knows what this member paid a share", and a screen that prints today's price for both is
 * how the original fault stayed invisible for so long.
 */
export function shareUnitPriceOf(tx) {
  if (!tx) return null;

  const stored = Number(tx.unit_price);
  if (Number.isFinite(stored) && stored > 0) return stored;

  const described = parseShareDescription(tx.description);
  return described ? described.unitPrice : null;
}

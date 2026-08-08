/**
 * One password rule, in one place.
 *
 * The three forms that set a password disagreed with each other:
 *
 *   SignUp.tsx        minLength 8
 *   RegisterSacco.tsx minLength 8, error text "at least 8 characters"
 *   ResetPassword.jsx minLength 6, error text "at least 6 characters"
 *
 * So a member signed up under an eight-character rule and could then reset their way down
 * to six -- the reset form was quietly the weakest door into the same account. Worse, the
 * rule was only ever discoverable by failing: no form said what it wanted until it
 * rejected you.
 *
 * Eight is kept because it is what the two registration paths already enforced; lowering
 * everything to six to match the odd one out would have weakened every existing account's
 * replacement password.
 */
export const PASSWORD_MIN_LENGTH = 8;

/** Said on the form before they type, not after they submit. */
export const PASSWORD_RULE_TEXT = `At least ${PASSWORD_MIN_LENGTH} characters.`;

/**
 * Validates a new password. Returns an error string, or null when it is acceptable.
 *
 * Deliberately not a strength meter: this app is used by members who may be typing on a
 * feature-phone keyboard, and a rule nobody can satisfy gets written on a piece of paper
 * beside the phone. Length is the requirement that actually survives that.
 */
export function checkNewPassword(password, confirmation) {
  const value = String(password || '');

  if (!value) return 'Enter a password.';
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (confirmation !== undefined && value !== String(confirmation || '')) {
    return 'The two passwords do not match.';
  }

  return null;
}

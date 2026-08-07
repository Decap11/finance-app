"use client";

import "../styles/alertDot.css";

/**
 * The bouncing dot that says something is waiting for this person.
 *
 * Rendered as a sibling of whatever it marks, inside an `.alert-dot-anchor`, so it can be
 * positioned over an icon without the icon having to know about it.
 *
 * @param {number}  count    How many things are waiting. 0 renders nothing at all.
 * @param {boolean} showCount  Put the number in the dot. Off over a small icon like the
 *                             hamburger, where a digit is unreadable and the dot alone
 *                             already carries the message.
 * @param {string}  label    Announced to screen readers. A silent dot is not a
 *                           notification to anybody using one, and this is the only cue
 *                           the app gives that an action is waiting.
 * @param {string}  ring     Colour of the halo, so the dot separates from whatever is
 *                           behind it -- white on the header, the sidebar's own blue in
 *                           the nav.
 */
export default function AlertDot({
  count = 0,
  showCount = false,
  label = "You have items needing attention",
  inline = false,
  ring
}) {
  if (!count || count < 1) return null;

  const classes = [
    "alert-dot",
    showCount ? "has-count" : "",
    inline ? "inline" : ""
  ].filter(Boolean).join(" ");

  return (
    <span
      className={classes}
      role="status"
      aria-label={`${label} (${count})`}
      style={ring ? { "--alert-dot-ring": ring } : undefined}
    >
      {/* Capped so a long backlog cannot stretch the pill across the label beside it. */}
      {showCount ? (count > 9 ? "9+" : count) : null}
    </span>
  );
}

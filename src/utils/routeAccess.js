/**
 * Which page a signed-in user belongs on, given who they are and where they asked to go.
 *
 * Pulled out of ProtectedRoute so the rules can be tested against the shipped source. They
 * previously existed only inside a "use client" component wrapped around an effect, a
 * router and two storage reads, none of which a node:test process can drive -- so the suite
 * that claimed to cover them defined its own private copy of the logic and asserted against
 * that instead. It passed whether or not the app agreed with it, which is the one thing a
 * guard test must never do.
 *
 * What this decides is navigation, not permission. These rules are enforced in the browser
 * and a determined caller simply skips them; what actually protects a SACCO's records is
 * RLS plus the authorization checks inside the SECURITY DEFINER RPCs, which is asserted
 * separately in tests/api/. Getting this wrong shows the wrong screen. It does not hand
 * anybody data they could not otherwise reach.
 */

/** Set when an admin chooses "Switch to Member View", cleared when they switch back. */
export const MEMBER_VIEW_KEY = 'pewosa:admin-viewing-as-member';

/**
 * @param {object} where
 * @param {string} where.pathname              The route being visited.
 * @param {string} where.role                  'admin' | 'member' | whatever the profile says.
 * @param {boolean} where.askedForMemberView   ?view=member is on the current URL.
 * @param {boolean} where.memberViewRemembered The tab already recorded that choice.
 * @returns {string|null} Path to redirect to, or null to stay put.
 */
export function routeRedirect({
  pathname,
  role,
  askedForMemberView = false,
  memberViewRemembered = false
} = {}) {
  const path = pathname || '';

  // Non-admins may never reach admin-only routes, regardless of SACCO membership.
  if (path.startsWith('/admin') && role !== 'admin') {
    return '/dashboard';
  }

  // A SACCO admin opening the app at /dashboard is carried on to the admin dashboard, so
  // launching the installed PWA lands them on their own screen.
  //
  // Unless they asked to be here. "Switch to Member View" navigates to
  // /dashboard?view=member, and without this the redirect fired straight afterwards and
  // threw them back to /admin -- so the menu item existed, did nothing visible, and the two
  // views could not be switched between at all. The choice is remembered for the tab
  // because a member-view visit to /savings and back would otherwise arrive at a bare
  // /dashboard and bounce again.
  if (path === '/dashboard' && role === 'admin') {
    if (!askedForMemberView && !memberViewRemembered) {
      return '/admin';
    }
  }

  return null;
}

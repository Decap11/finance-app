import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { routeRedirect, MEMBER_VIEW_KEY } from '../../src/utils/routeAccess.js';

/**
 * The page-level routing rules, exercised against the module ProtectedRoute actually calls.
 *
 * This suite used to define its own copy of `determineRouteRedirection` and assert against
 * that. It passed regardless of what the app did -- including the member-view case, which
 * the copy did not model at all, so the bug where "Switch to Member View" bounced straight
 * back to /admin would not have registered here. The rules now live in
 * src/utils/routeAccess.js and both the component and this file read that one definition.
 *
 * Scope worth being clear about: these are navigation rules enforced in the browser. They
 * decide which screen someone lands on, not what data they can reach. A caller who skips
 * them entirely gets an empty shell -- the records are held behind RLS and the
 * authorization checks inside the SECURITY DEFINER RPCs, which tests/api/ covers.
 */
describe('protected route redirection', () => {
  describe('admin-only routes', () => {
    test('a member reaching /admin is sent to the member dashboard', () => {
      assert.equal(routeRedirect({ pathname: '/admin', role: 'member' }), '/dashboard');
    });

    test('a member reaching a nested admin route is sent away too', () => {
      assert.equal(
        routeRedirect({ pathname: '/admin/members', role: 'member' }),
        '/dashboard'
      );
    });

    test('an unrecognised role is treated as not-admin', () => {
      // Anything that is not literally 'admin' fails the test, so a typo or a role added
      // later cannot accidentally open the admin section.
      assert.equal(routeRedirect({ pathname: '/admin', role: 'treasurer' }), '/dashboard');
      assert.equal(routeRedirect({ pathname: '/admin', role: '' }), '/dashboard');
      assert.equal(routeRedirect({ pathname: '/admin', role: undefined }), '/dashboard');
    });

    test('an admin stays on /admin', () => {
      assert.equal(routeRedirect({ pathname: '/admin', role: 'admin' }), null);
    });

    test('a path merely starting with the letters admin is still guarded', () => {
      // startsWith('/admin') also catches /administration; being sent to the dashboard is
      // the safe direction, and this records that it is deliberate rather than a surprise.
      assert.equal(
        routeRedirect({ pathname: '/administration', role: 'member' }),
        '/dashboard'
      );
    });
  });

  describe('admins landing on the member dashboard', () => {
    test('an admin opening /dashboard is carried on to /admin', () => {
      assert.equal(routeRedirect({ pathname: '/dashboard', role: 'admin' }), '/admin');
    });

    test('a member opening /dashboard stays there', () => {
      assert.equal(routeRedirect({ pathname: '/dashboard', role: 'member' }), null);
    });

    test('an admin who asked for member view is left alone', () => {
      // The regression that made "Switch to Member View" appear to do nothing: without
      // this, the redirect above fired immediately after the menu item navigated.
      assert.equal(
        routeRedirect({ pathname: '/dashboard', role: 'admin', askedForMemberView: true }),
        null
      );
    });

    test('the choice survives navigating away and back without ?view=member', () => {
      // A member-view visit to /savings and back arrives at a bare /dashboard. Only the
      // remembered flag stops it bouncing to /admin.
      assert.equal(
        routeRedirect({
          pathname: '/dashboard',
          role: 'admin',
          askedForMemberView: false,
          memberViewRemembered: true
        }),
        null
      );
    });
  });

  describe('everything else', () => {
    for (const pathname of ['/savings', '/loans', '/transactions', '/settings', '/members']) {
      test(`${pathname} is not redirected for either role`, () => {
        assert.equal(routeRedirect({ pathname, role: 'member' }), null);
        assert.equal(routeRedirect({ pathname, role: 'admin' }), null);
      });
    }

    test('a missing pathname does not throw', () => {
      assert.equal(routeRedirect({ role: 'member' }), null);
      assert.equal(routeRedirect(), null);
    });
  });

  test('the storage key is the one the headers and sidebars import', () => {
    assert.equal(MEMBER_VIEW_KEY, 'pewosa:admin-viewing-as-member');
  });
});

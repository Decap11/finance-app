import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Unit test for protected route role redirection logic
 */
function determineRouteRedirection(pathname, role) {
  // Non-admins reaching admin routes get sent to /dashboard
  if (pathname.startsWith('/admin') && role !== 'admin') {
    return '/dashboard';
  }

  // SACCO Admins entering /dashboard get routed to /admin
  if (pathname === '/dashboard' && role === 'admin') {
    return '/admin';
  }

  // No redirection needed
  return null;
}

describe('Protected Route Role Redirection Guards', () => {
  test('non-admin user accessing /admin is redirected to /dashboard', () => {
    const redirect = determineRouteRedirection('/admin', 'member');
    assert.equal(redirect, '/dashboard');
  });

  test('non-admin user accessing /admin/members is redirected to /dashboard', () => {
    const redirect = determineRouteRedirection('/admin/members', 'member');
    assert.equal(redirect, '/dashboard');
  });

  test('admin user accessing /admin stays on /admin', () => {
    const redirect = determineRouteRedirection('/admin', 'admin');
    assert.equal(redirect, null, 'Admin should not be redirected away from /admin');
  });

  test('admin user accessing /dashboard is automatically routed to /admin', () => {
    const redirect = determineRouteRedirection('/dashboard', 'admin');
    assert.equal(redirect, '/admin', 'Admin entering /dashboard should auto-route to /admin');
  });

  test('member user accessing /dashboard stays on /dashboard', () => {
    const redirect = determineRouteRedirection('/dashboard', 'member');
    assert.equal(redirect, null, 'Member should stay on /dashboard');
  });
});

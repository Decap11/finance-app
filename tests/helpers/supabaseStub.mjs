/**
 * A fake PostgREST client over plain arrays.
 *
 * Supports the slice of the builder these routes use: .from().select().eq()/.in()/.ilike()
 * .order().limit(), finished with .maybeSingle() or awaited for a list, plus .upsert() and
 * .auth.getUser().
 *
 * `ilike` implements real SQL LIKE semantics -- % and _ as wildcards, backslash escaping,
 * and PostgREST's own * -> % translation -- rather than a string compare. That matters: the
 * escaping in the settings route exists precisely because a group code arrives from a query
 * string, and a stub that treated the pattern as a literal would report the escaping working
 * whether or not it was there.
 */

/** SQL LIKE -> RegExp, including PostgREST's * -> % translation. */
export function likeToRegex(pattern) {
  const sql = pattern.replace(/(^|[^\\])\*/g, '$1%');
  let out = '^';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === '\\') { out += sql[++i]?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') ?? ''; continue; }
    if (ch === '%') { out += '.*'; continue; }
    if (ch === '_') { out += '.'; continue; }
    out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${out}$`, 'i');
}

function makeClient(db, token, state) {
  return {
    from(table) {
      state.queries.push(table);
      const preds = [];
      let orderCol = null;
      let descending = false;
      let cap = Infinity;

      const q = {
        select() { return q; },
        eq(col, val) { preds.push((r) => r[col] === val); return q; },
        in(col, vals) { preds.push((r) => vals.includes(r[col])); return q; },
        ilike(col, pattern) {
          state.patterns.push({ table, column: col, pattern });
          const re = likeToRegex(pattern);
          preds.push((r) => re.test(String(r[col] ?? '')));
          return q;
        },
        order(col, opts) { orderCol = col; descending = opts?.ascending === false; return q; },
        limit(n) { cap = n; return q; },
        upsert(row) { state.upserts.push({ table, row }); return Promise.resolve({ error: null }); },
        update(row) {
          const target = { table, row, preds };
          return {
            eq(col, val) {
              target.preds = [...preds, (r) => r[col] === val];
              state.updates.push(target);
              return Promise.resolve({ error: null });
            }
          };
        },
        rows() {
          let out = (db[table] || []).filter((r) => preds.every((p) => p(r)));
          if (orderCol) {
            out = [...out].sort((a, b) => (descending
              ? String(b[orderCol]).localeCompare(String(a[orderCol]))
              : String(a[orderCol]).localeCompare(String(b[orderCol]))));
          }
          return out.slice(0, cap);
        },
        maybeSingle() {
          const rows = q.rows();
          // PostgREST errors rather than picking one when more than one row matches.
          if (rows.length > 1) return Promise.resolve({ data: null, error: { code: 'PGRST116' } });
          return Promise.resolve({ data: rows[0] || null, error: null });
        },
        then(resolve, reject) {
          return Promise.resolve({ data: q.rows(), error: null }).then(resolve, reject);
        }
      };
      return q;
    },

    auth: {
      getUser() {
        const user = (db.__tokens || {})[token];
        if (!user) {
          return Promise.resolve({ data: { user: null }, error: { message: 'Invalid token' } });
        }
        return Promise.resolve({ data: { user }, error: null });
      }
    }
  };
}

/**
 * A `createClient` stand-in bound to one fixture.
 *
 * The bearer token is recovered from the options the route passes, which is what lets a
 * single stub serve both the service-role client (no token) and the caller-scoped one.
 */
export function stubClientFactory(db) {
  const state = { queries: [], upserts: [], updates: [], patterns: [] };

  const factory = (url, key, opts) => {
    const token = opts?.global?.headers?.Authorization?.split(' ')[1] || null;
    return makeClient(db, token, state);
  };

  factory.state = state;
  factory.reset = () => {
    state.queries.length = 0;
    state.upserts.length = 0;
    state.updates.length = 0;
    state.patterns.length = 0;
  };

  return factory;
}

/** A Request-alike carrying just what these handlers read. */
export function fakeRequest(url, token = null) {
  return {
    url,
    headers: {
      get: (h) => (h.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : null)
    }
  };
}

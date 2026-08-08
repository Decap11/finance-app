/**
 * Scoped realtime subscriptions.
 *
 * Every `postgres_changes` subscription in this app used to be `event: '*'` on a whole
 * table with NO filter. Seventeen components did it, eight of them on `transactions`. The
 * consequence only shows up with users on it:
 *
 *   One contribution approved anywhere in the database -- any SACCO, any member -- woke
 *   every subscription on every open page, and each one answered by refetching. RLS stops
 *   another tenant READING the row, but the event still fires and the refetch still runs,
 *   so the work is done and thrown away. At one user it is invisible. At a thousand, a
 *   single approval fans out into thousands of refetches, each paying a full round trip.
 *
 * Postgres publishes the filter, so a filtered subscription is not merely a client-side
 * `if` -- the event never reaches the browser at all.
 *
 * The other thing these helpers fix is a race. A channel is created synchronously inside an
 * effect, but the id to filter on arrives from an await. Subscribing first and filtering
 * later is not possible; a filter is fixed at subscribe time. So the helpers below own the
 * whole lifecycle: resolve the id, then subscribe, and if the component unmounts before the
 * id lands, never subscribe at all.
 *
 * Channel names are made unique per call. Two components sharing a literal name is a
 * collision that silently drops one of their subscriptions.
 */
import { supabase } from '../supabaseClient';

let channelSeq = 0;

function uniqueName(prefix) {
  channelSeq += 1;
  return `${prefix}-${channelSeq}`;
}

/**
 * Watch only the signed-in member's OWN rows.
 *
 * For the tables a member's own screens draw -- their transactions, their accounts, their
 * loans, their vaults -- `profile_id` is the whole of what they are allowed to see anyway,
 * so filtering on it costs nothing in correctness and removes every other member's writes
 * from the wire.
 *
 * @param {string[]} tables    e.g. ['transactions', 'accounts']
 * @param {Function} onChange  called on any matching insert/update/delete
 * @param {string}   name      channel prefix, for debugging in the Supabase dashboard
 * @returns {Function} unsubscribe -- call it from the effect's cleanup
 */
export function subscribeToOwnRows(tables, onChange, name = 'own-rows') {
  let channel = null;
  let cancelled = false;

  supabase.auth.getUser().then(({ data: { user } = {} }) => {
    // Unmounted while the id was in flight, or signed out. Either way there is nothing
    // to listen to, and subscribing now would leak a channel nobody removes.
    if (cancelled || !user?.id) return;

    let ch = supabase.channel(uniqueName(name));
    tables.forEach((table) => {
      ch = ch.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `profile_id=eq.${user.id}` },
        onChange
      );
    });
    channel = ch.subscribe();
  }).catch(() => {
    // A realtime subscription is an optimisation over the fetch the component already
    // did on mount. Failing to establish one must never take a screen down.
  });

  return () => {
    cancelled = true;
    if (channel) supabase.removeChannel(channel);
  };
}

/**
 * Watch one named member's rows.
 *
 * The explicit-id twin of subscribeToOwnRows, for screens that can be pointed at somebody
 * else -- the contribution heatmap takes a `memberId` prop, so an admin inspecting a
 * member's history must follow THAT member's writes, not their own. Passing a falsy id
 * does not subscribe, which is the right behaviour while the prop is still resolving.
 */
export function subscribeToProfileRows(profileId, tables, onChange, name = 'profile-rows') {
  if (!profileId) return () => {};

  let ch = supabase.channel(uniqueName(name));
  tables.forEach((table) => {
    ch = ch.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `profile_id=eq.${profileId}` },
      onChange
    );
  });

  const channel = ch.subscribe();
  return () => supabase.removeChannel(channel);
}

/**
 * Watch every row belonging to one SACCO.
 *
 * For staff screens, which legitimately draw the whole group. The caller supplies the id
 * because they have already resolved it to run their own query; passing a falsy id simply
 * does not subscribe, which is the correct behaviour while it is still loading.
 *
 * @param {string}   saccoId   null/undefined is tolerated -- no subscription is made
 * @param {string[]} tables
 * @param {Function} onChange
 * @param {string}   name
 * @returns {Function} unsubscribe
 */
export function subscribeToSaccoRows(saccoId, tables, onChange, name = 'sacco-rows') {
  if (!saccoId) return () => {};

  let ch = supabase.channel(uniqueName(name));
  tables.forEach((table) => {
    ch = ch.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `sacco_id=eq.${saccoId}` },
      onChange
    );
  });

  const channel = ch.subscribe();
  return () => supabase.removeChannel(channel);
}

/**
 * Watch one table on an arbitrary column match.
 *
 * The escape hatch for tables that do not key on `profile_id` or `sacco_id`. Guarantee
 * requests are the case that needs it: `loan_guarantors` names the two sides separately,
 * and the member being ASKED is `guarantor_profile_id` -- filtering that table on
 * `profile_id` would match no column at all and silently deliver nothing.
 */
export function subscribeToColumn(table, column, value, onChange, name = 'scoped-rows') {
  if (!value) return () => {};

  const channel = supabase
    .channel(uniqueName(name))
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `${column}=eq.${value}` },
      onChange
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

/**
 * The signed-in user's SACCO id, resolved once per page load.
 *
 * Five staff components each need this to scope their subscription, and each would
 * otherwise repeat the same two queries -- profiles for the group code, then saccos for
 * the id. The promise is memoised rather than the value so that components mounting in the
 * same tick share one round trip instead of racing four more.
 *
 * Deliberately module-level and never invalidated: a session's SACCO does not change
 * without a sign-out, and a sign-out reloads the app.
 */
let saccoIdPromise = null;

export function resolveOwnSaccoId() {
  if (saccoIdPromise) return saccoIdPromise;

  saccoIdPromise = (async () => {
    const { data: { user } = {} } = await supabase.auth.getUser();
    if (!user?.id) return null;

    const { data: profile } = await supabase
      .from('profiles')
      .select('group_id')
      .eq('id', user.id)
      .maybeSingle();

    const groupCode = (profile?.group_id || '').trim();
    if (!groupCode) return null;

    const { data: sacco } = await supabase
      .from('saccos')
      .select('id')
      .ilike('group_code', groupCode)
      .maybeSingle();

    return sacco?.id || null;
  })().catch(() => null);

  return saccoIdPromise;
}

/**
 * Watch a whole SACCO's rows without the caller having to resolve its id first.
 *
 * The staff twin of subscribeToOwnRows. Same lifecycle guarantee: if the component
 * unmounts while the id is in flight, no channel is ever opened.
 */
export function subscribeToOwnSaccoRows(tables, onChange, name = 'own-sacco-rows') {
  let channel = null;
  let cancelled = false;

  resolveOwnSaccoId().then((saccoId) => {
    if (cancelled || !saccoId) return;

    let ch = supabase.channel(uniqueName(name));
    tables.forEach((table) => {
      ch = ch.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `sacco_id=eq.${saccoId}` },
        onChange
      );
    });
    channel = ch.subscribe();
  });

  return () => {
    cancelled = true;
    if (channel) supabase.removeChannel(channel);
  };
}

/**
 * Watch the signed-in user's own SACCO configuration, resolving the id first.
 *
 * Three screens re-read their settings on any change to `sacco_settings` or `saccos`.
 * Both are low-traffic tables, so this is the least costly of the unfiltered subscriptions
 * -- but it is also the easiest to scope, and an unfiltered one still means every SACCO in
 * the platform saving its settings re-reads every other SACCO's screens.
 */
export function subscribeToOwnSaccoSettings(onChange, name = 'own-sacco-settings') {
  let unsubscribe = () => {};
  let cancelled = false;

  resolveOwnSaccoId().then((saccoId) => {
    if (cancelled || !saccoId) return;
    unsubscribe = subscribeToSaccoSettings({ saccoId }, onChange, name);
  });

  return () => {
    cancelled = true;
    unsubscribe();
  };
}

/**
 * Watch one SACCO's configuration.
 *
 * Separate from the two above because these tables are keyed differently: `sacco_settings`
 * carries both `sacco_id` and `group_code`, while `saccos` is keyed by its own `id`. A
 * caller mid-migration may hold either, so both are accepted and the filter follows
 * whichever was given.
 *
 * @param {{ saccoId?: string, groupCode?: string }} scope
 */
export function subscribeToSaccoSettings(scope, onChange, name = 'sacco-settings') {
  const { saccoId, groupCode } = scope || {};
  if (!saccoId && !groupCode) return () => {};

  let ch = supabase.channel(uniqueName(name));

  ch = ch.on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'sacco_settings',
      filter: saccoId ? `sacco_id=eq.${saccoId}` : `group_code=eq.${groupCode}`
    },
    onChange
  );

  // public.saccos is keyed on its own primary key, so it can only be filtered when the id
  // is known. With just a group code, this table is left unfiltered rather than unwatched:
  // it is a low-traffic table and losing the settings refresh would be the worse trade.
  if (saccoId) {
    ch = ch.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'saccos', filter: `id=eq.${saccoId}` },
      onChange
    );
  }

  const channel = ch.subscribe();
  return () => supabase.removeChannel(channel);
}

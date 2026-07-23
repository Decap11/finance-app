import { getPublicSupabase } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const publicSupabase = getPublicSupabase();
    const { searchParams } = new URL(request.url);
    const saccoId = searchParams.get('saccoId');

    if (!saccoId) {
      return Response.json({ error: 'saccoId parameter is required' }, { status: 400 });
    }

    // 1. Fetch SACCO info
    const { data: sacco, error: saccoErr } = await publicSupabase
      .from('saccos')
      .select('*')
      .eq('id', saccoId)
      .single();

    if (saccoErr || !sacco) {
      return Response.json({ error: 'SACCO not found: ' + (saccoErr?.message || '') }, { status: 404 });
    }

    // 2. Fetch SACCO settings
    const { data: settings } = await publicSupabase
      .from('sacco_settings')
      .select('*')
      .ilike('group_code', sacco.group_code)
      .limit(1);

    // 3. Fetch linked member profiles
    const { data: members } = await publicSupabase
      .from('profiles')
      .select('id, full_name, email, phone_number, member_number, status, created_at')
      .ilike('group_id', sacco.group_code);

    const memberIds = (members || []).map(m => m.id);

    // 4. Fetch accounts
    let accounts = [];
    if (memberIds.length > 0) {
      const { data: accData } = await publicSupabase
        .from('accounts')
        .select('*')
        .in('profile_id', memberIds);
      accounts = accData || [];
    }

    // 5. Fetch transactions
    const { data: transactions } = await publicSupabase
      .from('transactions')
      .select('*')
      .eq('sacco_id', saccoId)
      .order('created_at', { ascending: false });

    // 6. Fetch loans
    const { data: loans } = await publicSupabase
      .from('loans')
      .select('*')
      .eq('sacco_id', saccoId)
      .order('created_at', { ascending: false });

    const exportPackage = {
      sacco,
      settings: settings && settings.length > 0 ? settings[0] : null,
      members: members || [],
      accounts: accounts || [],
      transactions: transactions || [],
      loans: loans || [],
      exportedAt: new Date().toISOString(),
      exporter: "Pewosa SACCO Developer Portal"
    };

    const fileName = `sacco_backup_${sacco.group_code || 'tenant'}_${new Date().toISOString().split('T')[0]}.json`;

    return new Response(JSON.stringify(exportPackage, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${fileName}"`
      }
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

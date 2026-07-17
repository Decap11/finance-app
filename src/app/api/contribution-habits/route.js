import { promises as fs } from 'fs';
import path from 'path';
import { verifyAuth } from '../../../lib/auth';

export async function GET(request) {
  try {
    const auth = await verifyAuth(request);
    if (auth.error) return auth.error;

    const { user, supabase } = auth;

    // 1. Fetch SACCO group settings
    let settings = {
      sharePrice: 25000,
      devtFund: 1000,
      socialFund: 2000,
      currentWeek: 1,
      isLocked: false
    };
    try {
      const filePath = path.join(process.cwd(), 'src/app/api/sacco-settings/settings.json');
      const data = await fs.readFile(filePath, 'utf8');
      settings = JSON.parse(data);
    } catch (err) {
      console.warn("Failed to load active settings, using fallback:", err);
    }

    // 2. Query transactions for current year
    const startOfYear = `${new Date().getFullYear()}-01-01`;

    const { data: transactions, error: txErr } = await supabase
      .from('transactions')
      .select('*')
      .eq('profile_id', user.id)
      .in('category', ['shares', 'development_fund', 'social_fund'])
      .eq('direction', 'credit')
      .in('status', ['completed', 'approved'])
      .gte('created_at', startOfYear)
      .order('created_at', { ascending: true });

    if (txErr) {
      return Response.json({ error: txErr.message }, { status: 500 });
    }

    return Response.json({ transactions, settings });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

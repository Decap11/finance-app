import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'fs';
import path from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

export async function GET(request) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.split(' ')[1];

    if (!token) {
      return Response.json({ error: 'No authorization token provided.' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return Response.json({ error: authErr?.message || 'Authentication failed.' }, { status: 401 });
    }

    // 1. Fetch SACCO group settings
    let settings = {
      sharePrice: 25000,
      devtFund: 1000,
      socialFund: 2000,
      currentWeek: 1,
      isLocked: false
    };
    try {
      const { getActiveSaccoSettings } = await import('../sacco-settings/route.js');
      settings = await getActiveSaccoSettings(groupCode);
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

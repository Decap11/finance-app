import { promises as fs } from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const getFilePath = () => path.join(process.cwd(), 'src/app/api/sacco-settings/settings.json');

export async function GET() {
  try {
    const filePath = getFilePath();
    const data = await fs.readFile(filePath, 'utf8');
    return Response.json(JSON.parse(data));
  } catch (err) {
    return Response.json({
      sharePrice: 25000,
      devtFund: 1000,
      socialFund: 2000,
      currentWeek: 1,
      isLocked: false
    });
  }
}

export async function POST(request) {
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

    // Verify user role is admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      return Response.json({ error: 'Unauthorized. Only admins can modify group settings.' }, { status: 403 });
    }

    const body = await request.json();
    const { sharePrice, devtFund, socialFund, currentWeek, isLocked } = body;

    const newSettings = {
      sharePrice: Number(sharePrice) || 25000,
      devtFund: Number(devtFund) || 1000,
      socialFund: Number(socialFund) || 2000,
      currentWeek: Number(currentWeek) || 1,
      isLocked: Boolean(isLocked)
    };

    const filePath = getFilePath();
    await fs.writeFile(filePath, JSON.stringify(newSettings, null, 2), 'utf8');

    return Response.json({ success: true, settings: newSettings });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

import { promises as fs } from 'fs';
import path from 'path';
import { verifyAuth, verifyAdmin } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

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
    // Verify caller is admin
    const auth = await verifyAdmin(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { sharePrice, devtFund, socialFund, currentWeek, isLocked } = body;

    // Server-side validations
    const parsedSharePrice = Number(sharePrice);
    const parsedDevtFund = Number(devtFund);
    const parsedSocialFund = Number(socialFund);
    const parsedCurrentWeek = Number(currentWeek);

    if (isNaN(parsedSharePrice) || parsedSharePrice < 0) {
      return Response.json({ error: 'Share price must be a non-negative number.' }, { status: 400 });
    }
    if (isNaN(parsedDevtFund) || parsedDevtFund < 0) {
      return Response.json({ error: 'Development fund price must be a non-negative number.' }, { status: 400 });
    }
    if (isNaN(parsedSocialFund) || parsedSocialFund < 0) {
      return Response.json({ error: 'Social fund price must be a non-negative number.' }, { status: 400 });
    }
    if (isNaN(parsedCurrentWeek) || parsedCurrentWeek < 1 || parsedCurrentWeek > 52 || !Number.isInteger(parsedCurrentWeek)) {
      return Response.json({ error: 'Current week must be an integer between 1 and 52.' }, { status: 400 });
    }

    const newSettings = {
      sharePrice: parsedSharePrice,
      devtFund: parsedDevtFund,
      socialFund: parsedSocialFund,
      currentWeek: parsedCurrentWeek,
      isLocked: Boolean(isLocked)
    };

    const filePath = getFilePath();
    await fs.writeFile(filePath, JSON.stringify(newSettings, null, 2), 'utf8');

    return Response.json({ success: true, settings: newSettings });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

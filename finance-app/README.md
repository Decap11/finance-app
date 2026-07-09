# SACCO Finance

SACCO Finance is a Next.js application for managing Savings and Credit Cooperative Organization workflows. It includes member dashboards, savings and share tracking, loan request and repayment screens, contribution approvals, group member views, settings, onboarding, and admin dashboard surfaces.

## Stack

- Next.js
- React
- Supabase client
- Tail
- Optional `json-server` mock data

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Scripts

- `npm run dev`: start the Next.js development server.
- `npm run build`: create a production build.
- `npm run start`: start the production server after building.
- `npm run lint`: run ESLint.
- `npm run server`: run `json-server` against `data/data.json` on port `5000`.

## Environment

Create `.env` with:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## Project Notes

The app currently uses a localStorage-backed mock state layer for most SACCO workflows. Supabase is partially wired for signup and should be expanded with Supabase Auth, RLS policies, and database-backed financial workflows before production use.

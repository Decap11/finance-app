import { createClient } from '@supabase/supabase-js';

const url = 'https://dfrvkqabzviajvosuwgc.supabase.co';
const anonKey = 'sb_publishable_DvitvvoiXT9AakZORRBnyw_cOE50tyI';

const supabase = createClient(url, anonKey);

const devEmail = 'developer@pewosa.org';
const devPassword = 'PewosaDev2026!';

async function registerDevAccount() {
  console.log(`Creating Supabase Auth account for ${devEmail}...`);

  const { data, error } = await supabase.auth.signUp({
    email: devEmail,
    password: devPassword,
    options: {
      data: {
        full_name: 'Platform Developer',
        role: 'admin'
      }
    }
  });

  if (error) {
    console.error('SignUp Error:', error.message);
    // If user already exists, try signing in to test password
    console.log('Testing sign-in...');
    const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
      email: devEmail,
      password: devPassword
    });

    if (signInErr) {
      console.error('SignIn Error:', signInErr.message);
    } else {
      console.log('Successfully signed in with developer credentials!');
    }
  } else {
    console.log('Successfully registered developer account:', data.user?.id);
  }
}

registerDevAccount();

import { createClient } from '@supabase/supabase-js';

const url = 'https://dfrvkqabzviajvosuwgc.supabase.co';
const anonKey = 'sb_publishable_DvitvvoiXT9AakZORRBnyw_cOE50tyI';

const supabase = createClient(url, anonKey);

async function testSignIn() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'developer@pewosa.org',
    password: 'PewosaDev2026!'
  });

  if (error) {
    console.error('Sign-in Test Failed:', error.message);
  } else {
    console.log('SUCCESS! Authenticated User ID:', data.user?.id, 'Email:', data.user?.email);
  }
}

testSignIn();

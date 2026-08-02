import { createClient } from '@supabase/supabase-js';

const url = 'https://dfrvkqabzviajvosuwgc.supabase.co';
const anonKey = 'sb_publishable_DvitvvoiXT9AakZORRBnyw_cOE50tyI';

const supabase = createClient(url, anonKey);

async function checkUser() {
  console.log('Testing developer login for developer@pewosa.org...');
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, email, role')
    .ilike('email', '%developer%');

  console.log('Matching profiles in database:', profiles, error);
}

checkUser();

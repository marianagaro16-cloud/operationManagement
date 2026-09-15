/**
 * Removes every throwaway account the verify scripts create.
 *
 * Each verify script deletes its own users when it finishes, but a crash or a
 * refused delete can leave one behind — and a leftover "Push user" then shows
 * up in the real user list. All of them share one shape, zz-…@example.com (or
 * .invalid), which no real person's address has, so this sweep is safe to run
 * after any test session.
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env' });

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const TEST_EMAIL = /^zz-.+@example\.(com|invalid)$/i;

const leftovers = [];
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  leftovers.push(...data.users.filter((u) => TEST_EMAIL.test(u.email ?? '')));
  if (data.users.length < 200) break;
}

let failed = 0;
for (const user of leftovers) {
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    failed++;
    console.log(`  could not remove ${user.email}: ${error.message}`);
  } else {
    console.log(`  removed ${user.email}`);
  }
}
console.log(`${leftovers.length - failed} test user(s) removed${failed ? `, ${failed} failed` : ''}.`);
process.exitCode = failed ? 1 : 0;

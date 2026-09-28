import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { TEAMS, type Team } from '@/lib/authz';

/**
 * Teams whose activities are kept off the calendar.
 *
 * The database holds the rule — it refuses any day of a paused team's
 * activity — so this is only for not OFFERING what would be refused.
 */
export const PAUSED_ACTIVITY_TEAMS_KEY = 'paused_activity_teams';

export async function getPausedActivityTeams(): Promise<Team[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', PAUSED_ACTIVITY_TEAMS_KEY)
    .maybeSingle();

  const value = (data as { value: unknown } | null)?.value;
  if (!Array.isArray(value)) return [];
  return TEAMS.filter((team) => value.includes(team));
}

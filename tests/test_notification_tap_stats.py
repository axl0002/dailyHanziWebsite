"""Run the actual staff RPC in disposable PostgreSQL, without production data."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BIN = Path('/opt/homebrew/opt/postgresql@16/bin')


class NotificationTapStatsTest(unittest.TestCase):
    def test_canonical_events_signup_cohort_distinct_users_and_staff_gate(self):
        if not (BIN/'initdb').exists():
            self.skipTest('PostgreSQL 16 binaries unavailable')
        with tempfile.TemporaryDirectory(prefix='website-notification-rpc-') as tmp:
            tmp = Path(tmp)
            def run(name, *args, input=None, check=True):
                return subprocess.run([str(BIN/name), *map(str,args)], input=input,
                    capture_output=True, text=True, check=check)
            run('initdb', '-D', tmp/'db', '-A', 'trust', '--no-locale', '--encoding=UTF8')
            run('pg_ctl', '-D', tmp/'db', '-l', tmp/'server.log', '-o',
                f"-F -k {tmp} -p 55450 -c listen_addresses='' -c timezone=UTC", '-w', 'start')
            try:
                def sql(query, check=True):
                    return run('psql','-h',tmp,'-p','55450','-d','postgres','-XqAt',
                        '-v','ON_ERROR_STOP=1',input=query,check=check)
                sql("""create function public.is_staff() returns boolean language sql as
                    $$select coalesce(current_setting('test.is_staff',true),'false')='true'$$;
                    create table profiles(id int primary key,is_beta bool,is_pro bool,created_at timestamptz);
                    create table client_events(user_id int,event text,props jsonb,created_at timestamptz);
                    insert into profiles values
                      (1,false,true,'2026-10-01'),(2,false,true,'2026-10-01'),
                      (3,false,true,'2026-01-01'),(4,false,false,'2026-10-01'),
                      (5,true,true,'2026-10-01'),(6,false,true,'2026-10-01'),
                      (7,false,null,'2026-10-01');
                    insert into client_events values
                      (1,'push_notification_tapped','{"type":"daily_sentence"}','2026-10-01'),
                      (1,'push_notification_tapped','{"type":"daily_sentence"}','2026-10-02'),
                      (1,'push_notification_tapped','{"type":"daily_story"}','2026-10-03'),
                      (3,'push_notification_tapped','{"type":"daily_sentence"}','2026-10-01'),
                      (4,'push_notification_tapped','{"type":"daily_story"}','2026-09-01'),
                      (5,'push_notification_tapped','{"type":"daily_story"}','2026-10-01'),
                      (6,'notification_tapped','{"type":"daily_sentence"}','2026-10-01'),
                      (7,'push_notification_tapped','{}','2026-10-01');
                """)
                source = (ROOT/'supabase/policies/analytics_client_events.sql').read_text()
                start = source.index('create or replace function public.notification_tap_stats(')
                end = source.index('\nrevoke all on function public.notification_tap_stats',start)
                sql(source[start:end])
                denied = sql("select notification_tap_stats(null);",check=False)
                self.assertNotEqual(denied.returncode,0)
                self.assertIn('not authorized',denied.stderr)
                def stats(since):
                    result = sql("set test.is_staff='true'; select notification_tap_stats("+since+");")
                    return {r['type']:r for r in json.loads(result.stdout)}
                rows = stats("'2026-09-26'")
                self.assertEqual(set(rows),{'No taps recorded','daily_sentence','daily_story','unknown'})
                # Repeated taps count a person once per type; a person may be
                # present in both type bars. The beta user is excluded.
                self.assertEqual(rows['daily_sentence']['pro'],1)
                self.assertEqual(rows['daily_story']['pro'],1)
                self.assertEqual(rows['daily_story']['free'],1)
                self.assertEqual(rows['unknown']['free'],1)
                self.assertEqual(rows['No taps recorded']['pro'],2)
                # Date range intentionally uses profile join date. The old
                # signup with a recent tap is excluded; a new signup's older
                # recorded tap still counts. All-time includes the old user.
                self.assertEqual(stats('null')['daily_sentence']['pro'],2)
            finally:
                run('pg_ctl','-D',tmp/'db','-m','immediate','-w','stop')


if __name__ == '__main__':
    unittest.main()

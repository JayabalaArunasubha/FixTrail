-- Read-only check: compares the live database with supabase/schema.sql.
-- Paste into the Supabase SQL editor and run. It only SELECTs; nothing is created or changed.
-- Every row says what it checked, whether it is present, and any detail worth knowing.

with expected_columns(tbl, col, typ) as (
  values
    ('profiles','id','uuid'), ('profiles','display_name','text'), ('profiles','role','text'), ('profiles','created_at','timestamp with time zone'),
    ('issues','id','uuid'), ('issues','title','text'), ('issues','description','text'), ('issues','building','text'),
    ('issues','location','text'), ('issues','category','text'), ('issues','reporter_id','uuid'), ('issues','reporter_name','text'),
    ('issues','priority','text'), ('issues','status','text'), ('issues','assigned_team','text'), ('issues','assigned_to','text'),
    ('issues','created_at','timestamp with time zone'), ('issues','updated_at','timestamp with time zone'),
    ('issues','due_at','timestamp with time zone'), ('issues','resolved_at','timestamp with time zone'),
    ('issues','resolution_notes','text'), ('issues','photo_path','text'), ('issues','resolution_photo_path','text'),
    ('issues','client_request_id','uuid'),
    ('ai_assessments','id','uuid'), ('ai_assessments','issue_id','uuid'), ('ai_assessments','model_name','text'),
    ('ai_assessments','prompt_version','text'), ('ai_assessments','model_recommendation','jsonb'),
    ('ai_assessments','safety_override','jsonb'), ('ai_assessments','assessment_status','text'),
    ('ai_assessments','error','text'), ('ai_assessments','created_at','timestamp with time zone'),
    ('issue_activity','id','uuid'), ('issue_activity','issue_id','uuid'), ('issue_activity','actor_id','uuid'),
    ('issue_activity','actor_name','text'), ('issue_activity','action_type','text'), ('issue_activity','details','jsonb'),
    ('issue_activity','created_at','timestamp with time zone')
),
fixtrail_tables(tbl) as (values ('profiles'), ('issues'), ('ai_assessments'), ('issue_activity')),
expected_policies(tbl, pol) as (
  values ('profiles','own profile'), ('issues','read own or staff'), ('ai_assessments','read assessments'), ('issue_activity','read activity')
)
select * from (
  -- 1. Tables
  select 1 as ord, 'table' as kind, 'public.' || t.tbl as item,
         case when c.oid is null then 'MISSING' else 'present' end as status,
         case when c.oid is null then '' else 'rows: ' || coalesce(s.n_live_tup, 0) end as detail
  from fixtrail_tables t
  left join pg_class c on c.relname = t.tbl and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  left join pg_stat_user_tables s on s.relid = c.oid

  union all
  -- 2. Expected columns (only reported for tables that exist)
  select 2, 'column', e.tbl || '.' || e.col,
         case when ic.column_name is null then 'MISSING'
              when ic.data_type <> e.typ then 'TYPE DIFFERS' else 'present' end,
         case when ic.column_name is not null and ic.data_type <> e.typ then 'found ' || ic.data_type || ', expected ' || e.typ else '' end
  from expected_columns e
  join information_schema.tables it on it.table_schema = 'public' and it.table_name = e.tbl
  left join information_schema.columns ic on ic.table_schema = 'public' and ic.table_name = e.tbl and ic.column_name = e.col
  where ic.column_name is null or ic.data_type <> e.typ

  union all
  -- 3. Extra columns on existing FixTrail-named tables (sign of a different app using the same name)
  select 3, 'extra column', ic.table_name || '.' || ic.column_name, 'UNEXPECTED', ic.data_type
  from information_schema.columns ic
  join fixtrail_tables t on t.tbl = ic.table_name
  where ic.table_schema = 'public'
    and not exists (select 1 from expected_columns e where e.tbl = ic.table_name and e.col = ic.column_name)

  union all
  -- 4. Row Level Security
  select 4, 'rls', 'public.' || c.relname,
         case when c.relrowsecurity then 'enabled' else 'DISABLED' end, ''
  from pg_class c join fixtrail_tables t on t.tbl = c.relname
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'

  union all
  -- 5. Expected policies
  select 5, 'policy', e.tbl || ': "' || e.pol || '"',
         case when p.policyname is null then 'MISSING' else 'present' end,
         coalesce(p.cmd || ' using ' || p.qual, '')
  from expected_policies e
  left join pg_policies p on p.schemaname = 'public' and p.tablename = e.tbl and p.policyname = e.pol

  union all
  -- 6. Other policies already on these tables (would remain alongside FixTrail's)
  select 6, 'other policy', p.tablename || ': "' || p.policyname || '"', 'EXISTING', p.cmd || ' using ' || coalesce(p.qual, 'true')
  from pg_policies p
  join fixtrail_tables t on t.tbl = p.tablename
  where p.schemaname = 'public'
    and not exists (select 1 from expected_policies e where e.tbl = p.tablename and e.pol = p.policyname)

  union all
  -- 7. Functions (schema.sql uses CREATE OR REPLACE: an existing one with this name would be overwritten)
  select 7, 'function', 'public.' || f.fn,
         case when p.oid is null then 'MISSING' else 'present (would be REPLACED)' end, ''
  from (values ('handle_new_user'), ('is_staff')) f(fn)
  left join pg_proc p on p.proname = f.fn and p.pronamespace = 'public'::regnamespace

  union all
  -- 8. All triggers on auth.users (schema.sql drops & recreates on_auth_user_created)
  select 8, 'trigger on auth.users', tg.tgname,
         case when tg.tgname = 'on_auth_user_created' then 'present (would be REPLACED)' else 'EXISTING (other)' end,
         'calls ' || pr.pronamespace::regnamespace || '.' || pr.proname
  from pg_trigger tg join pg_proc pr on pr.oid = tg.tgfoid
  where tg.tgrelid = 'auth.users'::regclass and not tg.tgisinternal

  union all
  select 8, 'trigger on auth.users', 'on_auth_user_created', 'MISSING', ''
  where not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created')

  union all
  -- 9. Storage bucket
  select 9, 'storage bucket', 'attachments',
         case when b.id is null then 'MISSING' when b.public then 'present but PUBLIC' else 'present' end,
         coalesce('size limit ' || b.file_size_limit || ', types ' || array_to_string(b.allowed_mime_types, ','), '')
  from (select 1) one left join storage.buckets b on b.id = 'attachments'

  union all
  -- 10. Context: other tables in public, and how many auth users exist
  select 10, 'other public table', c.relname, 'EXISTING', 'rows: ' || coalesce(s.n_live_tup, 0)
  from pg_class c left join pg_stat_user_tables s on s.relid = c.oid
  where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    and c.relname not in (select tbl from fixtrail_tables)

  union all
  select 11, 'auth users', 'auth.users', 'count', (select count(*)::text from auth.users)
) report
order by ord, item;

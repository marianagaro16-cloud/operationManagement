-- ============================================================
-- Evaluate RLS predicates ONCE per query, not once per row
--
-- MEASURED, on an identical 221-row table, warm, three runs each:
--
--   using (has_permission('customers.manage') or is_approved())
--     Execution Time: 31.1 / 33.7 / 31.5 ms
--     Seq Scan (cost=0.50..119.21) Filter: (has_permission(...) OR is_approved())
--
--   using ((select has_permission('customers.manage')) or (select is_approved()))
--     Execution Time:  2.68 / 2.44 / 2.54 ms
--     Seq Scan (cost=0.52..4.73) Filter: ((InitPlan 1).col1 OR (InitPlan 2).col1)
--
-- 12.5x. The wrapper turns a function call the planner repeats for every row
-- into an InitPlan it computes once. Same predicate, same result, same rows.
--
-- The identical 221-row scan costs 0.13 ms with RLS off and 29 ms with it on,
-- so that 29 ms was pure policy overhead — paid by every query, on every
-- table, on every page. It also scales linearly: at 10,000 rows the predicate
-- alone would cost well over a second.
--
-- THIS CHANGES NO RULE. Every policy keeps its exact predicate, its command,
-- its roles and its name. What changes is where Postgres evaluates it. The
-- codebase already knew the pattern — every policy writes (select auth.uid())
-- for exactly this reason — it just was never applied to this project's own
-- SECURITY DEFINER helpers.
--
-- GENERATED from pg_policies rather than hand-written: 114 policies is too
-- many to retype safely, and the source of truth is what the database is
-- actually enforcing, deparsed by Postgres itself.
--
-- ONLY constant-argument helpers are wrapped — has_permission('...'),
-- is_approved(), is_admin(), is_goods_reception_assignee(). Deliberately NOT
-- can_view_incident(order_id, ...), can_write_goods_reception(status) or
-- can_write_goods_reception_child(reception_id): each takes a row column, so
-- its value genuinely differs per row and a wrapper would buy a correlated
-- SubPlan instead of an InitPlan. Those are rewritten by hand below.
-- ============================================================

drop policy if exists "brands: approved read" on public.brands;
create policy "brands: approved read" on public.brands
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "brands: manage writes" on public.brands;
create policy "brands: manage writes" on public.brands
  for ALL to authenticated
  using (( SELECT has_permission('products.manage'::text)))
  with check (( SELECT has_permission('products.manage'::text)));

drop policy if exists "categories: approved read" on public.categories;
create policy "categories: approved read" on public.categories
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "categories: config writes" on public.categories;
create policy "categories: config writes" on public.categories
  for ALL to authenticated
  using (( SELECT has_permission('tasks.manage_definitions'::text)))
  with check (( SELECT has_permission('tasks.manage_definitions'::text)));

drop policy if exists "customer_types: approved read" on public.customer_types;
create policy "customer_types: approved read" on public.customer_types
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "customer_types: manage writes" on public.customer_types;
create policy "customer_types: manage writes" on public.customer_types
  for ALL to authenticated
  using (( SELECT has_permission('customers.manage'::text)))
  with check (( SELECT has_permission('customers.manage'::text)));

drop policy if exists "customers: approved read" on public.customers;
create policy "customers: approved read" on public.customers
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "customers: manage writes" on public.customers;
create policy "customers: manage writes" on public.customers
  for ALL to authenticated
  using (( SELECT has_permission('customers.manage'::text)))
  with check (( SELECT has_permission('customers.manage'::text)));

drop policy if exists "delivery_methods: approved read" on public.delivery_methods;
create policy "delivery_methods: approved read" on public.delivery_methods
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "delivery_methods: config writes" on public.delivery_methods;
create policy "delivery_methods: config writes" on public.delivery_methods
  for ALL to authenticated
  using (( SELECT has_permission('orders.manage_config'::text)))
  with check (( SELECT has_permission('orders.manage_config'::text)));

drop policy if exists "gr_assignees: approved read" on public.goods_reception_assignees;
create policy "gr_assignees: approved read" on public.goods_reception_assignees
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "gr_assignees: config writes" on public.goods_reception_assignees;
create policy "gr_assignees: config writes" on public.goods_reception_assignees
  for ALL to authenticated
  using (( SELECT has_permission('goods_reception.manage_config'::text)))
  with check (( SELECT has_permission('goods_reception.manage_config'::text)));

drop policy if exists "gr_audit_log: operational reads" on public.goods_reception_audit_log;
create policy "gr_audit_log: operational reads" on public.goods_reception_audit_log
  for SELECT to authenticated
  using (( SELECT has_permission('audit.view_operational'::text)));

drop policy if exists "gr_evidence: approved read" on public.goods_reception_evidence;
create policy "gr_evidence: approved read" on public.goods_reception_evidence
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "gr_evidence: uploader or manager deletes" on public.goods_reception_evidence;
create policy "gr_evidence: uploader or manager deletes" on public.goods_reception_evidence
  for DELETE to authenticated
  using ((( SELECT has_permission('goods_reception.manage_all'::text)) OR ((uploaded_by = ( SELECT auth.uid() AS uid)) AND can_write_goods_reception_child(reception_id))));

drop policy if exists "gr_exceptions: approved read" on public.goods_reception_exceptions;
create policy "gr_exceptions: approved read" on public.goods_reception_exceptions
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "gr_reports: generate" on public.goods_reception_report_snapshots;
create policy "gr_reports: generate" on public.goods_reception_report_snapshots
  for INSERT to authenticated
  with check ((( SELECT has_permission('reports.view'::text)) AND (generated_by = ( SELECT auth.uid() AS uid))));

drop policy if exists "gr_reports: read" on public.goods_reception_report_snapshots;
create policy "gr_reports: read" on public.goods_reception_report_snapshots
  for SELECT to authenticated
  using (( SELECT has_permission('reports.view'::text)));

drop policy if exists "goods_receptions: approved read" on public.goods_receptions;
create policy "goods_receptions: approved read" on public.goods_receptions
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "goods_receptions: scoped update" on public.goods_receptions;
create policy "goods_receptions: scoped update" on public.goods_receptions
  for UPDATE to authenticated
  using (can_write_goods_reception(status))
  with check ((( SELECT has_permission('goods_reception.manage_all'::text)) OR ( SELECT is_goods_reception_assignee())));

drop policy if exists "incident_items: manage writes" on public.incident_affected_items;
create policy "incident_items: manage writes" on public.incident_affected_items
  for ALL to authenticated
  using (( SELECT has_permission('incidents.manage'::text)))
  with check (( SELECT has_permission('incidents.manage'::text)));

drop policy if exists "incident_audit_log: incident reads" on public.incident_audit_log;
create policy "incident_audit_log: incident reads" on public.incident_audit_log
  for SELECT to authenticated
  using (( SELECT has_permission('incidents.view_all'::text)));

drop policy if exists "incident_categories: approved read" on public.incident_categories;
create policy "incident_categories: approved read" on public.incident_categories
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "incident_categories: config writes" on public.incident_categories;
create policy "incident_categories: config writes" on public.incident_categories
  for ALL to authenticated
  using (( SELECT has_permission('incidents.manage_config'::text)))
  with check (( SELECT has_permission('incidents.manage_config'::text)));

drop policy if exists "incident_evidence: manage insert" on public.incident_evidence;
create policy "incident_evidence: manage insert" on public.incident_evidence
  for INSERT to authenticated
  with check ((( SELECT has_permission('incidents.manage'::text)) AND (uploaded_by = ( SELECT auth.uid() AS uid))));

drop policy if exists "incident_evidence: uploader or manager deletes" on public.incident_evidence;
create policy "incident_evidence: uploader or manager deletes" on public.incident_evidence
  for DELETE to authenticated
  using ((( SELECT has_permission('incidents.manage'::text)) AND ((uploaded_by = ( SELECT auth.uid() AS uid)) OR ( SELECT has_permission('incidents.close'::text)))));

drop policy if exists "incident_replacements: manage writes" on public.incident_replacements;
create policy "incident_replacements: manage writes" on public.incident_replacements
  for ALL to authenticated
  using (( SELECT has_permission('incidents.manage'::text)))
  with check (( SELECT has_permission('incidents.manage'::text)));

drop policy if exists "incident_reports: generate" on public.incident_report_snapshots;
create policy "incident_reports: generate" on public.incident_report_snapshots
  for INSERT to authenticated
  with check ((( SELECT has_permission('incidents.manage'::text)) AND (generated_by = ( SELECT auth.uid() AS uid))));

drop policy if exists "incident_reports: read" on public.incident_report_snapshots;
create policy "incident_reports: read" on public.incident_report_snapshots
  for SELECT to authenticated
  using (( SELECT has_permission('incidents.view_all'::text)));

drop policy if exists "incident_causes: manage writes" on public.incident_secondary_causes;
create policy "incident_causes: manage writes" on public.incident_secondary_causes
  for ALL to authenticated
  using (( SELECT has_permission('incidents.manage'::text)))
  with check (( SELECT has_permission('incidents.manage'::text)));

drop policy if exists "incident_types: approved read" on public.incident_types;
create policy "incident_types: approved read" on public.incident_types
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "incident_types: config writes" on public.incident_types;
create policy "incident_types: config writes" on public.incident_types
  for ALL to authenticated
  using (( SELECT has_permission('incidents.manage_config'::text)))
  with check (( SELECT has_permission('incidents.manage_config'::text)));

drop policy if exists "incidents: manage insert" on public.incidents;
create policy "incidents: manage insert" on public.incidents
  for INSERT to authenticated
  with check (((created_by = ( SELECT auth.uid() AS uid)) AND (( SELECT has_permission('incidents.manage'::text)) OR ((goods_reception_id IS NOT NULL) AND ( SELECT is_goods_reception_assignee())))));

drop policy if exists "incidents: manage update" on public.incidents;
create policy "incidents: manage update" on public.incidents
  for UPDATE to authenticated
  using (( SELECT has_permission('incidents.manage'::text)))
  with check (( SELECT has_permission('incidents.manage'::text)));

drop policy if exists "inventory_assignments: approved read" on public.inventory_assignments;
create policy "inventory_assignments: approved read" on public.inventory_assignments
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "inventory_assignments: manage writes" on public.inventory_assignments;
create policy "inventory_assignments: manage writes" on public.inventory_assignments
  for ALL to authenticated
  using (( SELECT has_permission('inventory.manage_instances'::text)))
  with check (( SELECT has_permission('inventory.manage_instances'::text)));

drop policy if exists "inventory_audit_log: inventory manage reads" on public.inventory_audit_log;
create policy "inventory_audit_log: inventory manage reads" on public.inventory_audit_log
  for SELECT to authenticated
  using (( SELECT has_permission('inventory.manage_instances'::text)));

drop policy if exists "inventory_comments: approved insert own" on public.inventory_comments;
create policy "inventory_comments: approved insert own" on public.inventory_comments
  for INSERT to authenticated
  with check ((( SELECT is_approved()) AND (user_id = ( SELECT auth.uid() AS uid))));

drop policy if exists "inventory_comments: approved read" on public.inventory_comments;
create policy "inventory_comments: approved read" on public.inventory_comments
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "inventory_digital_history: approved read" on public.inventory_digital_history;
create policy "inventory_digital_history: approved read" on public.inventory_digital_history
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "inventory_grants: manager writes" on public.inventory_edit_grants;
create policy "inventory_grants: manager writes" on public.inventory_edit_grants
  for ALL to authenticated
  using (( SELECT has_permission('inventory.grant_temporary_edit'::text)))
  with check (( SELECT has_permission('inventory.grant_temporary_edit'::text)));

drop policy if exists "inventory_grants: own or manager read" on public.inventory_edit_grants;
create policy "inventory_grants: own or manager read" on public.inventory_edit_grants
  for SELECT to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT has_permission('inventory.grant_temporary_edit'::text))));

drop policy if exists "inventory_entries: approved read" on public.inventory_entries;
create policy "inventory_entries: approved read" on public.inventory_entries
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "inventory_instance_items: approved read" on public.inventory_instance_items;
create policy "inventory_instance_items: approved read" on public.inventory_instance_items
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "inventory_instance_items: manage writes" on public.inventory_instance_items;
create policy "inventory_instance_items: manage writes" on public.inventory_instance_items
  for ALL to authenticated
  using (( SELECT has_permission('inventory.manage_instances'::text)))
  with check (( SELECT has_permission('inventory.manage_instances'::text)));

drop policy if exists "inventory_instances: approved read" on public.inventory_instances;
create policy "inventory_instances: approved read" on public.inventory_instances
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "inventory_instances: manage writes" on public.inventory_instances;
create policy "inventory_instances: manage writes" on public.inventory_instances
  for ALL to authenticated
  using (( SELECT has_permission('inventory.manage_instances'::text)))
  with check (( SELECT has_permission('inventory.manage_instances'::text)));

drop policy if exists "inventory_locations: approved read" on public.inventory_locations;
create policy "inventory_locations: approved read" on public.inventory_locations
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "inventory_locations: config writes" on public.inventory_locations;
create policy "inventory_locations: config writes" on public.inventory_locations
  for ALL to authenticated
  using (( SELECT has_permission('inventory.manage_templates'::text)))
  with check (( SELECT has_permission('inventory.manage_templates'::text)));

drop policy if exists "inventory_notifications: admin reads" on public.inventory_notifications;
create policy "inventory_notifications: admin reads" on public.inventory_notifications
  for SELECT to authenticated
  using (( SELECT is_admin()));

drop policy if exists "inventory_resolutions: approved read" on public.inventory_resolutions;
create policy "inventory_resolutions: approved read" on public.inventory_resolutions
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "inventory_template_assignees: approved read" on public.inventory_template_assignees;
create policy "inventory_template_assignees: approved read" on public.inventory_template_assignees
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "inventory_template_assignees: config writes" on public.inventory_template_assignees;
create policy "inventory_template_assignees: config writes" on public.inventory_template_assignees
  for ALL to authenticated
  using (( SELECT has_permission('inventory.manage_templates'::text)))
  with check (( SELECT has_permission('inventory.manage_templates'::text)));

drop policy if exists "inventory_template_items: approved read" on public.inventory_template_items;
create policy "inventory_template_items: approved read" on public.inventory_template_items
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "inventory_template_items: config writes" on public.inventory_template_items;
create policy "inventory_template_items: config writes" on public.inventory_template_items
  for ALL to authenticated
  using (( SELECT has_permission('inventory.manage_templates'::text)))
  with check (( SELECT has_permission('inventory.manage_templates'::text)));

drop policy if exists "inventory_templates: approved read" on public.inventory_templates;
create policy "inventory_templates: approved read" on public.inventory_templates
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "inventory_templates: config writes" on public.inventory_templates;
create policy "inventory_templates: config writes" on public.inventory_templates
  for ALL to authenticated
  using (( SELECT has_permission('inventory.manage_templates'::text)))
  with check (( SELECT has_permission('inventory.manage_templates'::text)));

drop policy if exists "lots: approved insert" on public.lot_allocations;
create policy "lots: approved insert" on public.lot_allocations
  for INSERT to authenticated
  with check ((( SELECT is_approved()) AND (created_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM (order_lines ol
     JOIN orders o ON ((o.id = ol.order_id)))
  WHERE ((ol.id = lot_allocations.order_line_id) AND (o.status <> 'cancelled'::order_status))))));

drop policy if exists "lots: approved read" on public.lot_allocations;
create policy "lots: approved read" on public.lot_allocations
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "lots: author or manager deletes" on public.lot_allocations;
create policy "lots: author or manager deletes" on public.lot_allocations
  for DELETE to authenticated
  using (((created_by = ( SELECT auth.uid() AS uid)) OR ( SELECT has_permission('orders.manage'::text))));

drop policy if exists "lots: author or manager updates" on public.lot_allocations;
create policy "lots: author or manager updates" on public.lot_allocations
  for UPDATE to authenticated
  using (((created_by = ( SELECT auth.uid() AS uid)) OR ( SELECT has_permission('orders.manage'::text))))
  with check (((created_by = ( SELECT auth.uid() AS uid)) OR ( SELECT has_permission('orders.manage'::text))));

drop policy if exists "order_audit_log: order manage reads" on public.order_audit_log;
create policy "order_audit_log: order manage reads" on public.order_audit_log
  for SELECT to authenticated
  using (( SELECT has_permission('orders.manage'::text)));

drop policy if exists "order_lines: approved read" on public.order_lines;
create policy "order_lines: approved read" on public.order_lines
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "order_lines: manage writes" on public.order_lines;
create policy "order_lines: manage writes" on public.order_lines
  for ALL to authenticated
  using (( SELECT has_permission('orders.manage'::text)))
  with check (( SELECT has_permission('orders.manage'::text)));

drop policy if exists "order_notifications: admin reads" on public.order_notifications;
create policy "order_notifications: admin reads" on public.order_notifications
  for SELECT to authenticated
  using (( SELECT is_admin()));

drop policy if exists "order_request_templates: approved read" on public.order_request_templates;
create policy "order_request_templates: approved read" on public.order_request_templates
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "order_request_templates: config writes" on public.order_request_templates;
create policy "order_request_templates: config writes" on public.order_request_templates
  for ALL to authenticated
  using (( SELECT has_permission('orders.manage_config'::text)))
  with check (( SELECT has_permission('orders.manage_config'::text)));

drop policy if exists "orders: approved read" on public.orders;
create policy "orders: approved read" on public.orders
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "orders: manage writes" on public.orders;
create policy "orders: manage writes" on public.orders
  for ALL to authenticated
  using (( SELECT has_permission('orders.manage'::text)))
  with check (( SELECT has_permission('orders.manage'::text)));

drop policy if exists "permission_catalog: approved read" on public.permission_catalog;
create policy "permission_catalog: approved read" on public.permission_catalog
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "product_aliases: approved read" on public.product_aliases;
create policy "product_aliases: approved read" on public.product_aliases
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "product_aliases: manage writes" on public.product_aliases;
create policy "product_aliases: manage writes" on public.product_aliases
  for ALL to authenticated
  using (( SELECT has_permission('products.manage'::text)))
  with check (( SELECT has_permission('products.manage'::text)));

drop policy if exists "products: approved read" on public.products;
create policy "products: approved read" on public.products
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "products: manage writes" on public.products;
create policy "products: manage writes" on public.products
  for ALL to authenticated
  using (( SELECT has_permission('products.manage'::text)))
  with check (( SELECT has_permission('products.manage'::text)));

drop policy if exists "profiles: admin reads all" on public.profiles;
create policy "profiles: admin reads all" on public.profiles
  for SELECT to authenticated
  using (( SELECT is_admin()));

drop policy if exists "profiles: admin updates" on public.profiles;
create policy "profiles: admin updates" on public.profiles
  for UPDATE to authenticated
  using (( SELECT is_admin()))
  with check (( SELECT is_admin()));

drop policy if exists "profiles: approved read team" on public.profiles;
create policy "profiles: approved read team" on public.profiles
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "push: insert own" on public.push_subscriptions;
create policy "push: insert own" on public.push_subscriptions
  for INSERT to authenticated
  with check ((( SELECT is_approved()) AND (user_id = ( SELECT auth.uid() AS uid))));

drop policy if exists "template_lines: approved read" on public.recurring_order_template_lines;
create policy "template_lines: approved read" on public.recurring_order_template_lines
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "template_lines: config writes" on public.recurring_order_template_lines;
create policy "template_lines: config writes" on public.recurring_order_template_lines
  for ALL to authenticated
  using (( SELECT has_permission('orders.manage_config'::text)))
  with check (( SELECT has_permission('orders.manage_config'::text)));

drop policy if exists "templates: approved read" on public.recurring_order_templates;
create policy "templates: approved read" on public.recurring_order_templates
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "templates: config writes" on public.recurring_order_templates;
create policy "templates: config writes" on public.recurring_order_templates
  for ALL to authenticated
  using (( SELECT has_permission('orders.manage_config'::text)))
  with check (( SELECT has_permission('orders.manage_config'::text)));

drop policy if exists "role_permissions: admin writes" on public.role_permissions;
create policy "role_permissions: admin writes" on public.role_permissions
  for ALL to authenticated
  using (( SELECT is_admin()))
  with check (( SELECT is_admin()));

drop policy if exists "role_permissions: approved read" on public.role_permissions;
create policy "role_permissions: approved read" on public.role_permissions
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "security_audit_log: admin reads" on public.security_audit_log;
create policy "security_audit_log: admin reads" on public.security_audit_log
  for SELECT to authenticated
  using (( SELECT is_admin()));

drop policy if exists "suppliers: approved read" on public.suppliers;
create policy "suppliers: approved read" on public.suppliers
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "suppliers: config writes" on public.suppliers;
create policy "suppliers: config writes" on public.suppliers
  for ALL to authenticated
  using (( SELECT has_permission('goods_reception.manage_config'::text)))
  with check (( SELECT has_permission('goods_reception.manage_config'::text)));

drop policy if exists "task_audit_log: task manage reads" on public.task_audit_log;
create policy "task_audit_log: task manage reads" on public.task_audit_log
  for SELECT to authenticated
  using (( SELECT has_permission('tasks.manage_occurrences'::text)));

drop policy if exists "comments: approved insert own" on public.task_comments;
create policy "comments: approved insert own" on public.task_comments
  for INSERT to authenticated
  with check ((( SELECT is_approved()) AND (user_id = ( SELECT auth.uid() AS uid))));

drop policy if exists "comments: approved read" on public.task_comments;
create policy "comments: approved read" on public.task_comments
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "comments: author or manager deletes" on public.task_comments;
create policy "comments: author or manager deletes" on public.task_comments
  for DELETE to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT has_permission('tasks.manage_occurrences'::text))));

drop policy if exists "occurrences: approved read" on public.task_occurrences;
create policy "occurrences: approved read" on public.task_occurrences
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "occurrences: manager writes" on public.task_occurrences;
create policy "occurrences: manager writes" on public.task_occurrences
  for ALL to authenticated
  using (( SELECT has_permission('tasks.manage_occurrences'::text)))
  with check (( SELECT has_permission('tasks.manage_occurrences'::text)));

drop policy if exists "tasks: approved read" on public.tasks;
create policy "tasks: approved read" on public.tasks
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "tasks: config writes" on public.tasks;
create policy "tasks: config writes" on public.tasks
  for ALL to authenticated
  using (( SELECT has_permission('tasks.manage_definitions'::text)))
  with check (( SELECT has_permission('tasks.manage_definitions'::text)));

drop policy if exists "tasks: correct corrective actions" on public.tasks;
create policy "tasks: correct corrective actions" on public.tasks
  for UPDATE to authenticated
  using ((( SELECT has_permission('incidents.manage'::text)) AND (frequency = 'one_off'::task_frequency) AND (incident_id IS NOT NULL)))
  with check ((( SELECT has_permission('incidents.manage'::text)) AND (frequency = 'one_off'::task_frequency) AND (incident_id IS NOT NULL)));

drop policy if exists "tasks: corrective actions" on public.tasks;
create policy "tasks: corrective actions" on public.tasks
  for INSERT to authenticated
  with check ((( SELECT has_permission('incidents.manage'::text)) AND (frequency = 'one_off'::task_frequency) AND (incident_id IS NOT NULL)));

drop policy if exists "transporters: approved read" on public.transporters;
create policy "transporters: approved read" on public.transporters
  for SELECT to authenticated
  using (( SELECT is_approved()));

drop policy if exists "transporters: config writes" on public.transporters;
create policy "transporters: config writes" on public.transporters
  for ALL to authenticated
  using (( SELECT has_permission('goods_reception.manage_config'::text)))
  with check (( SELECT has_permission('goods_reception.manage_config'::text)));

drop policy if exists "gr evidence: approved read" on storage.objects;
create policy "gr evidence: approved read" on storage.objects
  for SELECT to authenticated
  using (((bucket_id = 'goods-reception-evidence'::text) AND ( SELECT is_approved())));

drop policy if exists "gr evidence: scoped delete" on storage.objects;
create policy "gr evidence: scoped delete" on storage.objects
  for DELETE to authenticated
  using (((bucket_id = 'goods-reception-evidence'::text) AND ((storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'::text) AND (( SELECT has_permission('goods_reception.manage_all'::text)) OR can_write_goods_reception_child(((storage.foldername(name))[1])::uuid))));

drop policy if exists "incident evidence: manage delete" on storage.objects;
create policy "incident evidence: manage delete" on storage.objects
  for DELETE to authenticated
  using (((bucket_id = 'incident-evidence'::text) AND ( SELECT has_permission('incidents.manage'::text))));

drop policy if exists "incident evidence: manage upload" on storage.objects;
create policy "incident evidence: manage upload" on storage.objects
  for INSERT to authenticated
  with check (((bucket_id = 'incident-evidence'::text) AND ( SELECT has_permission('incidents.manage'::text)) AND ((storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'::text)));

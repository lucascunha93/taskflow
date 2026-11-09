// Altera o plano de uma organização. Uso operacional enquanto não há cobrança
// integrada: npm run plan:set --workspace api -- <slug-da-organização> <FREE|PRO|BUSINESS>
// Usa DATABASE_URL do ambiente ou de apps/api/.env. Reduzir o plano não remove dados.
import 'dotenv/config';
import pg from 'pg';

const PLANS = ['FREE', 'PRO', 'BUSINESS'];
const [slug, plan] = process.argv.slice(2);

if (!slug || !PLANS.includes(plan)) {
  console.error('Uso: npm run plan:set --workspace api -- <slug-da-organização> <FREE|PRO|BUSINESS>');
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não está definida.');
  process.exit(2);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  const result = await client.query(
    `WITH previous AS (
       SELECT id, plan FROM organizations WHERE slug = $1 FOR UPDATE
     ), updated AS (
       UPDATE organizations o
          SET plan = $2::"OrganizationPlan",
              "planChangedAt" = CASE WHEN p.plan = $2::"OrganizationPlan" THEN o."planChangedAt" ELSE now() END,
              "updatedAt" = now()
         FROM previous p
        WHERE o.id = p.id
    RETURNING o.id, o.name, o.plan, p.plan AS "previousPlan"
     ), logged AS (
       -- Histórico da troca; sem autor, pois foi feita pelo script operacional.
       INSERT INTO plan_changes (id, "organizationId", "fromPlan", "toPlan")
       SELECT gen_random_uuid(), id, "previousPlan", plan FROM updated WHERE "previousPlan" <> plan
     )
     SELECT u.id, u.name, u.plan,
            (SELECT count(*) FROM memberships m WHERE m."organizationId" = u.id)::int AS members,
            (SELECT count(*) FROM projects p WHERE p."organizationId" = u.id)::int AS projects,
            (SELECT count(*) FROM tasks t WHERE t."organizationId" = u.id)::int AS tasks,
            (SELECT coalesce(sum(size), 0) FROM task_attachments a WHERE a."organizationId" = u.id)::bigint AS "storageBytes"
       FROM updated u`,
    [slug, plan],
  );
  await client.query("COMMIT");
  if (result.rowCount === 0) {
    console.error(`Organização não encontrada: ${slug}`);
    process.exitCode = 1;
  } else {
    const row = result.rows[0];
    console.log(`"${row.name}" agora está no plano ${row.plan}.`);
    console.log(`Uso atual: ${row.members} membros, ${row.projects} projetos, ${row.tasks} tarefas, ${row.storageBytes} bytes de anexos.`);
    console.log('Recursos acima dos limites do novo plano permanecem; apenas novas criações ficam bloqueadas.');
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

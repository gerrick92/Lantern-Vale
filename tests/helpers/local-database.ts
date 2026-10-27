import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

// Test-only Supabase transport backed by the actual local Postgres migrations.
// No environment file, hosted account, session or service credential is loaded.
export async function localDatabase(users: string[]) {
  const sql = new PGlite();
  await sql.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    create function auth.jwt() returns jsonb language sql stable as 'select jsonb_build_object(''aal'',current_setting(''request.jwt.claim.aal'',true))';
    grant usage on schema public,auth to anon,authenticated,service_role;`);
  for (const id of users)
    await sql.query("insert into auth.users values($1)", [id]);
  for (const file of readdirSync("supabase/migrations")
    .filter((file) => file.endsWith(".sql"))
    .sort())
    await sql.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  return databaseAdapter(sql);
}

// Reattach the test transport after restoring an existing database; never rerun migrations.
export function databaseAdapter(sql: PGlite) {
  const identifier = (name: string) => {
    if (!/^[a-z_]+$/.test(name))
      throw new Error("Invalid fixture SQL identifier.");
    return `"${name}"`;
  };
  const api = {
    async rpc(name: string, args: Record<string, unknown>) {
      try {
        const entries = Object.entries(args);
        const result = await sql.query<{ data: unknown }>(
          `select ${identifier(name)}(${entries.map(([key], index) => `${identifier(key)} => $${index + 1}`).join(",")}) as data`,
          entries.map(([, value]) => value),
        );
        return { data: result.rows[0].data, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    from(table: string) {
      let columns = "*",
        order = "",
        offset = 0,
        limit = 10000;
      const filters: [string, unknown][] = [];
      async function execute(single = false) {
        try {
          const rows = await sql.query<Record<string, unknown>>(
            `select ${columns} from ${identifier(table)} ${filters.length ? "where " + filters.map(([key], index) => `${identifier(key)}=$${index + 1}`).join(" and ") : ""} ${order} limit ${limit} offset ${offset}`,
            filters.map(([, value]) => value),
          );
          return {
            data: single ? (rows.rows[0] ?? null) : rows.rows,
            error: null,
          };
        } catch (error) {
          return { data: null, error };
        }
      }
      const query = {
        select(value: string) {
          columns =
            value === "*" ? value : value.split(",").map(identifier).join(",");
          return query;
        },
        eq(key: string, value: unknown) {
          filters.push([key, value]);
          return query;
        },
        order(key: string, options?: { ascending?: boolean }) {
          order = `order by ${identifier(key)} ${options?.ascending === false ? "desc" : "asc"}`;
          return query;
        },
        range(start: number, end: number) {
          offset = start;
          limit = end - start + 1;
          return query;
        },
        limit(value: number) {
          limit = value;
          return query;
        },
        maybeSingle() {
          return execute(true);
        },
        then: (
          resolve: (value: Awaited<ReturnType<typeof execute>>) => unknown,
          reject?: (error: unknown) => unknown,
        ) => execute().then(resolve, reject),
        async upsert(row: Record<string, unknown>) {
          if (table !== "game_settlement_results")
            throw new Error("Unexpected fixture upsert.");
          try {
            const keys = Object.keys(row);
            await sql.query(
              `insert into game_settlement_results (${keys.map(identifier).join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) on conflict (round_id) do update set ${keys
                .filter((key) => key !== "round_id")
                .map((key) => `${identifier(key)}=excluded.${identifier(key)}`)
                .join(",")}`,
              Object.values(row),
            );
            return { error: null };
          } catch (error) {
            return { error };
          }
        },
      };
      return query;
    },
  };
  return { sql, api };
}

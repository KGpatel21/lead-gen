import { resolveSslConfig } from "../server/db/sslMode";

const cases: Array<[string, string]> = [
  ["postgresql://postgres:root@localhost:5432/outbound_ai",                                         "local laptop dev"],
  ["postgresql://outbound:pw@postgres:5432/outbound_ai",                                            "Docker Compose service name"],
  ["postgresql://outbound:pw@127.0.0.1:5432/outbound_ai",                                           "loopback"],
  ["postgresql://outbound:pw@10.0.42.99:5432/outbound_ai",                                          "private VPC IP"],
  ["postgresql://outbound:pw@db-proxy.internal:5432/outbound_ai",                                   ".internal DNS"],
  ["postgresql://user:pw@prod-1.abcd1234.us-east-1.rds.amazonaws.com:5432/prod",                     "AWS RDS"],
  ["postgresql://user:pw@ep-plain-mud-a1234.us-east-2.aws.neon.tech/prod?sslmode=require",           "Neon (sslmode=require)"],
  ["postgresql://user:pw@some.railway.app:5432/prod",                                                "Railway"],
  ["postgresql://user:pw@aws-0-us-east-1.pooler.supabase.com:6543/prod",                             "Supabase pooler"],
  ["postgresql://user:pw@dpg-abc.render.com:5432/prod",                                              "Render"],
  ["postgresql://user:pw@server.postgres.database.azure.com:5432/prod",                              "Azure PG"],
  ["postgresql://user:pw@random-host.example.com:5432/prod",                                         "unknown public host"],
  ["postgresql://user:pw@random-host.example.com:5432/prod?sslmode=disable",                         "unknown + sslmode=disable"],
];

for (const [url, label] of cases) {
  const r = resolveSslConfig(url);
  const state = r.ssl === false ? "OFF" : "ON ";
  console.log(`  ${state}  ${label.padEnd(38)}  ← ${r.reason}`);
}

// -------- The critical EC2 regression cases --------
// The bug was: PGSSLMODE=require inherited from EC2 shell was making the
// resolver force SSL even for the container Postgres. The new precedence
// makes private-host classification authoritative.
console.log("\n  --- EC2 regression cases (private host wins over env) ---");
process.env.PGSSLMODE = "require";
{
  const r = resolveSslConfig("postgresql://outbound:pw@postgres:5432/outbound_ai");
  console.log(`  ${r.ssl === false ? "OFF" : "ON "}  Docker Compose + PGSSLMODE=require   ← ${r.reason}`);
}
process.env.DATABASE_SSL = "true";
{
  const r = resolveSslConfig("postgresql://postgres:root@localhost:5432/outbound_ai");
  console.log(`  ${r.ssl === false ? "OFF" : "ON "}  localhost + DATABASE_SSL=true        ← ${r.reason}`);
}

// Opt-back-in: URL sslmode=require lets you FORCE SSL even to a private host.
{
  const r = resolveSslConfig("postgresql://user:pw@postgres:5432/prod?sslmode=require");
  console.log(`  ${r.ssl === false ? "OFF" : "ON "}  private + URL sslmode=require        ← ${r.reason}`);
}

// Explicit off still wins over cloud.
delete process.env.PGSSLMODE;
delete process.env.DATABASE_SSL;
{
  const r = resolveSslConfig("postgresql://user:pw@prod-1.rds.amazonaws.com:5432/prod?sslmode=disable");
  console.log(`  ${r.ssl === false ? "OFF" : "ON "}  RDS + sslmode=disable                ← ${r.reason}`);
}

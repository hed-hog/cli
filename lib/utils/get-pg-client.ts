export async function getPostgresClient(envVars: Record<string, string>) {
  const { Client } = await import('pg');
  const client = new Client({
    host: envVars.DB_HOST,
    user: envVars.DB_USERNAME,
    password: envVars.DB_PASSWORD,
    database: envVars.DB_DATABASE,
    port: Number(envVars.DB_PORT),
  });
  await client.connect();
  return client;
}

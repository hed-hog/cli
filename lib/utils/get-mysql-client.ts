export async function getMySQLClient(envVars: Record<string, string>) {
  const mysql = await import('mysql2/promise');
  const connection = await mysql.createConnection({
    host: envVars.DB_HOST,
    user: envVars.DB_USERNAME,
    password: envVars.DB_PASSWORD,
    database: envVars.DB_DATABASE,
    port: Number(envVars.DB_PORT),
  });

  return connection;
}

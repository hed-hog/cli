/**
 * Generates an environment file template for database configuration.
 *
 * @param type - The type of database to use, either 'postgres' or 'mysql'. Defaults to 'postgres'.
 * @returns {string} A string representing the contents of an environment (.env) file,
 *          including database type, host, port, username, password, database name,
 *          and a full database URL.
 */
export const getEnvFileTemplate = (
    type: 'postgres' | 'mysql' = 'postgres',
): string => `
DB_TYPE=${type}
DB_HOST=localhost
DB_PORT=${type === 'postgres' ? 5432 : 3306}
DB_USERNAME=hedhog
DB_PASSWORD=changeme
DB_DATABASE=hedhog

DATABASE_URL=\${DB_TYPE}://\${DB_USERNAME}:\${DB_PASSWORD}@\${DB_HOST}:\${DB_PORT}/\${DB_DATABASE}
`;

export const getEnvFileTemplate = (type: 'postgres' | 'mysql' = 'postgres') => `
DB_TYPE=${type}
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=hedhog
DB_PASSWORD=changeme
DB_DATABASE=hedhog

DATABASE_URL=\${DB_TYPE}://\${DB_USERNAME}:\${DB_PASSWORD}@\${DB_HOST}:\${DB_PORT}/\${DB_DATABASE}
`;

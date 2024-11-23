export const getEnvFileTemplate = (type: 'postgres' | 'mysql' = 'postgres') => `
DB_TYPE=${type}
DB_HOST=localhost
DB_PORT=${type === 'postgres' ? 5432 : 3306}
DB_USERNAME=hedhog
DB_PASSWORD=changeme
DB_DATABASE=hedhog

DATABASE_URL=\${DB_TYPE}://\${DB_USERNAME}:\${DB_PASSWORD}@\${DB_HOST}:\${DB_PORT}/\${DB_DATABASE}
`;

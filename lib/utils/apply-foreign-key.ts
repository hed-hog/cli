async function applyForeignKey(
  db: any,
  tableName: string,
  foreignTableName: string,
) {
  const query = `
      SELECT
        kcu.column_name,
        tc.constraint_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM
        information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE
        tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = ?;
    `;

  await db.query(query, [tableName]);

  const applyForeignKeyQuery = `
      ALTER TABLE ${tableName}
      ADD CONSTRAINT fk_${tableName}_${foreignTableName}
      FOREIGN KEY (${tableName}_id)
      REFERENCES ${foreignTableName} (id);
    `;

  try {
    await db.query(applyForeignKeyQuery);
  } catch (error) {
    console.error('Error applying foreign key:', error);
  }
}

async function insertRoute(db: any, route: Route) {
  await db.query(
    'INSERT INTO routes (url, method, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
    [route.url, route.method],
  );
}

export async function applyHedhogFileDataRoutes(db: any, routes: Route[]) {
  try {
    for (const route of routes) {
      await insertRoute(db, route);
    }
  } catch (error) {
    console.error('Error inserting route data:', error);
  }
}

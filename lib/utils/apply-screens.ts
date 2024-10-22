import { Screen } from '../types/screen';

async function insertScreen(db: any, screen: Screen) {
  const { slug, icon, name, description } = screen;

  const result = await db.query(
    'INSERT INTO screens (slug, icon, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())',
    [slug, icon],
  );
  const screenId = result.rows[0].id;

  for (const localeCode in name) {
    const localeResult = await db.query(
      'SELECT id FROM locales WHERE code = $1',
      [localeCode],
    );
    const localeId = localeResult.rows[0].id;

    await db.query(
      'INSERT INTO screen_translations (screen_id, locale_id, name, description) VALUES ($1, $2, $3, $4)',
      [screenId, localeId, name[localeCode], description[localeCode]],
    );
  }
}

export async function applyHedhogFileDataScreens(db: any, screens: Screen[]) {
  try {
    for (const screen of screens) {
      await insertScreen(db, screen);
    }
  } catch (error) {
    console.error('Error inserting screen data:', error);
  }
}

import { AbstractDatabase } from '../databases';
import { Menu } from '../types/menu';

async function insertMenu(db: any, parentId: number | null, menu: Menu) {
  const rows = await db.query(
    'INSERT INTO menus (url, icon, menu_id, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
    [menu.url, menu.icon, parentId],
    {
      returning: 'id',
    },
  );
  const menuId = rows[0].id;

  for (const localeCode in menu.name) {
    const rows = await db.query('SELECT id FROM locales WHERE code = ?', [
      localeCode,
    ]);
    if (rows.length > 0) {
      const localeId = rows[0].id;
      await db.query(
        'INSERT INTO menu_translations (menu_id, locale_id, name) VALUES (?, ?, ?)',
        [menuId, localeId, menu.name[localeCode]],
      );
    } else {
      console.error(`Locale with code "${localeCode}" not found.`);
    }
  }

  if (menu.menus && menu.menus.length > 0) {
    for (const m of menu.menus) {
      await insertMenu(db, menuId, m);
    }
  }
}

export async function applyHedhogFileDataMenus(db: any, menus: Menu[]) {
  try {
    for (const menu of menus) {
      const { menu_id } = menu;

      let parentId: number | null = null;

      if (menu_id && typeof menu_id === 'object') {
        const rows = await db.query(
          `SELECT id FROM menus WHERE ${AbstractDatabase.objectToWhereClause(menu_id)}`,
        );

        if (rows.length > 0) {
          parentId = rows[0].id;
        } else {
          console.error(`Menu with URL "${menu_id.url}" not found.`);
          continue;
        }
      }

      await insertMenu(db, parentId, menu);
    }
  } catch (error) {
    console.error('Error inserting menu data:', error);
    throw error;
  }
}

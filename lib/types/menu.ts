import { Locale } from './locale';

export type Menu = {
  url: string;
  icon: string;
  name: Locale;
  slug: string;
  order?: string;
  menus?: Menu[];
  menu_id?: number | null | Partial<Menu>;
  relations?: any;
};

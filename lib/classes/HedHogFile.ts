import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { parse } from 'yaml';

export class HedhogFile {
  private path: string = '';
  private content: any = {};

  async load(path: string) {
    this.path = path;
    await this.init();
    return this.content;
  }

  private async init() {
    if (existsSync(this.path)) {
      this.content = parse(await readFile(this.path, 'utf-8'));
    }
  }

  tables() {
    return Object.keys(this.content.tables || {});
  }

  hasLocale(tableName: string) {
    const key = `${tableName}_locale`;
    return key in this.content.tables;
  }

  screensWithRelations() {
    if (!this.content.screens) {
      throw new Error('No screens found in the hedhog file');
    }

    const screens = this.content.screens || {};
    return Object.keys(screens)
      .filter((screen) => screens[screen].relations)
      .map((screen) => ({
        name: screen,
        relations: Object.keys(screens[screen].relations),
      }));
  }
}

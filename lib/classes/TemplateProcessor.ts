import { join } from 'path';
import { readFile } from 'fs/promises';
import { render } from 'ejs';
import { toObjectCase } from '../utils/convert-string-cases';

class TemplateProcessor {
  private relationTables: any[];
  private panelTemplatePath: string;
  private customTemplatePath: string;
  private functionTemplatePath: string;
  private extraVars: string[];
  private extraImports: string[];
  private libraryName: string;

  constructor(relationTables: any[], libraryName: string) {
    this.libraryName = libraryName;
    this.relationTables = relationTables;
    this.panelTemplatePath = join(__dirname, '..', '..', 'templates', 'panel');
    this.functionTemplatePath = join(
      __dirname,
      '..',
      '..',
      'templates',
      'function',
    );
    this.customTemplatePath = join(
      __dirname,
      '..',
      '..',
      'templates',
      'custom',
    );
    this.extraVars = [];
    this.extraImports = [];
  }

  private async renderTemplate(
    templatePath: string,
    context: object = {},
  ): Promise<string> {
    const templateContent = await readFile(templatePath, 'utf-8');
    return render(templateContent, context);
  }

  private async processTable(tableName: string): Promise<{
    variableRendering: string;
    importPanelRendering: string;
    importsRendering: string;
  }> {
    const tableNameCase = toObjectCase(tableName);
    const libraryNameCase = toObjectCase(this.libraryName);

    const [variableRendering, importPanelRendering, importsRendering] =
      await Promise.all([
        this.renderTemplate(
          join(this.panelTemplatePath, 'tab-panel-ref.ts.ejs'),
          { tableNameCase },
        ),
        this.renderTemplate(
          join(this.panelTemplatePath, 'import-panel.ts.ejs'),
          { tableNameCase, libraryNameCase },
        ),
        this.renderTemplate(
          join(this.panelTemplatePath, 'tab-panel-imports.ts.ejs'),
          { tableNameCase },
        ),
      ]);

    return { variableRendering, importPanelRendering, importsRendering };
  }

  private async processRelatedFunctions(relatedTable: string): Promise<{
    openUpdateRendering: string;
    openCreateRendering: string;
  }> {
    const tableNameRelatedCase = toObjectCase(relatedTable);

    const [openUpdateRendering, openCreateRendering] = await Promise.all([
      this.renderTemplate(
        join(this.functionTemplatePath, 'open-update.ts.ejs'),
        { tableNameRelatedCase },
      ),
      this.renderTemplate(
        join(this.functionTemplatePath, 'open-create.ts.ejs'),
        { tableNameRelatedCase },
      ),
    ]);

    return { openUpdateRendering, openCreateRendering };
  }

  private async processStaticImports(): Promise<void> {
    const [useAppVars, useAppImports] = await Promise.all([
      this.renderTemplate(join(this.customTemplatePath, 'use-app-vars.ts.ejs')),
      this.renderTemplate(
        join(this.customTemplatePath, 'import-use-app.ts.ejs'),
      ),
    ]);

    this.extraVars.push(useAppVars);
    this.extraImports.push(useAppImports);
  }

  async processAllTables(): Promise<{
    extraVars: string[];
    extraImports: string[];
  }> {
    await this.processStaticImports();
    for (const tableName of this.relationTables) {
      const { variableRendering, importPanelRendering, importsRendering } =
        await this.processTable(tableName);

      const { openUpdateRendering, openCreateRendering } =
        await this.processRelatedFunctions(tableName);

      this.extraVars.push(
        variableRendering,
        openCreateRendering,
        openUpdateRendering,
      );
      this.extraImports.push(importPanelRendering, importsRendering);
    }

    return { extraVars: this.extraVars, extraImports: this.extraImports };
  }
}

export default TemplateProcessor;

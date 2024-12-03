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
  private libraryNameCase: object;

  constructor(relationTables: any[], libraryName: string) {
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
    this.libraryNameCase = toObjectCase(libraryName);
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
    importsRendering: string;
  }> {
    const tableNameCase = toObjectCase(tableName);
    const [variableRendering, importsRendering] = await Promise.all([
      this.renderTemplate(
        join(this.panelTemplatePath, 'tab-panel-vars.ts.ejs'),
        { tableNameCase },
      ),
      this.renderTemplate(
        join(this.panelTemplatePath, 'tab-panel-imports.ts.ejs'),
        { tableNameCase, libraryNameCase: this.libraryNameCase },
      ),
    ]);

    return { variableRendering, importsRendering };
  }

  private async processRelatedFunctions(relatedTable: string): Promise<{
    openUpdateRendering: string;
    openCreateRendering: string;
    openDeleteRendering: string;
  }> {
    const tableNameRelatedCase = toObjectCase(relatedTable);

    const [openUpdateRendering, openCreateRendering, openDeleteRendering] =
      await Promise.all([
        this.renderTemplate(
          join(this.functionTemplatePath, 'open-update.ts.ejs'),
          { tableNameRelatedCase },
        ),
        this.renderTemplate(
          join(this.functionTemplatePath, 'open-create.ts.ejs'),
          { tableNameRelatedCase },
        ),
        this.renderTemplate(
          join(this.functionTemplatePath, 'open-delete.ts.ejs'),
          { tableNameRelatedCase, libraryNameCase: this.libraryNameCase },
        ),
      ]);

    return { openUpdateRendering, openCreateRendering, openDeleteRendering };
  }

  private async processStaticImports(): Promise<void> {
    const [useAppVars, useAppImports] = await Promise.all([
      this.renderTemplate(join(this.customTemplatePath, 'static-vars.ts.ejs')),
      this.renderTemplate(
        join(this.customTemplatePath, 'static-imports.ts.ejs'),
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
      const { variableRendering, importsRendering } =
        await this.processTable(tableName);

      const { openUpdateRendering, openCreateRendering, openDeleteRendering } =
        await this.processRelatedFunctions(tableName);

      this.extraVars.push(
        variableRendering,
        openCreateRendering,
        openUpdateRendering,
        openDeleteRendering,
      );
      this.extraImports.push(importsRendering);
    }

    return { extraVars: this.extraVars, extraImports: this.extraImports };
  }
}

export default TemplateProcessor;

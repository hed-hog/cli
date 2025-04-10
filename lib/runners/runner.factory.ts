import * as chalk from 'chalk';
import { DockerRunner } from './docker.runner';
import { NestJSRunner } from './nestjs.runner';
import { NpmRunner } from './npm.runner';
import { NpxRunner } from './npx.runner';
import { PnpmRunner } from './pnpm.runner';
import { Runner } from './runner';
import { SchematicRunner } from './schematic.runner';
import { YarnRunner } from './yarn.runner';

export class RunnerFactory {
  public static create(runner: Runner) {
    switch (runner) {
      case Runner.SCHEMATIC:
        return new SchematicRunner();

      case Runner.NPM:
        return new NpmRunner();

      case Runner.YARN:
        return new YarnRunner();

      case Runner.PNPM:
        return new PnpmRunner();

      case Runner.NPX:
        return new NpxRunner();

      case Runner.DOCKER:
        return new DockerRunner();

      case Runner.NESTJS:
        return new NestJSRunner();

      default:
        console.info(chalk.yellow(`[WARN] Unsupported runner: ${runner}`));
    }
  }
}

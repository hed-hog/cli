import { AbstractRunner } from './abstract.runner';

export class DockerRunner extends AbstractRunner {
  constructor() {
    super('docker');
  }
}

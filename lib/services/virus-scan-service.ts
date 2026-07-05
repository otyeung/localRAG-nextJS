import 'server-only';

export type VirusScanResult = {
  clean: true;
  scanner: 'local-noop';
};

export class VirusScanService {
  async scanFile(filePath: string): Promise<VirusScanResult> {
    if (!filePath.startsWith('/')) {
      throw new Error('Virus scan requires an absolute file path.');
    }

    return { clean: true, scanner: 'local-noop' };
  }
}

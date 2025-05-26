import fs from 'fs/promises';

import type { Data } from './types.js';

export class DataPersistenceManager {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  public async saveData(data: Data): Promise<void> {
    try {
      await fs.writeFile(this.filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save data:', error);
      throw new Error('Failed to save data');
    }
  }

  public async loadData(): Promise<Data> {
    try {
      const rawData = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(rawData);
    } catch (error) {
      console.error('Failed to load data:', error);
      throw new Error('Failed to load data');
    }
  }

  public async resetData(): Promise<void> {
    try {
      const existingDataKeys = await JSON.parse(
        await fs.readFile(this.filePath, 'utf-8')
      );
      const emptyData = Object.fromEntries(
        Object.keys(existingDataKeys).map(key => [key, []])
      );
      await fs.writeFile(this.filePath, JSON.stringify(emptyData, null, 2));
    } catch (error) {
      console.error('Failed to reset data:', error);
      throw new Error('Failed to reset data');
    }
  }
}

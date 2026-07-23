import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import {
  observeDatabaseQuery,
  setDatabasePoolMetrics,
} from './metrics.decorator';

@Injectable()
export class DatabaseMetricsService implements OnModuleInit {
  constructor(private readonly dataSource: DataSource) {}

  onModuleInit(): void {
    this.instrumentQueryRunners();
    this.updatePoolMetrics();
    setInterval(() => this.updatePoolMetrics(), 15000).unref();
  }

  private instrumentQueryRunners(): void {
    const originalCreateQueryRunner = this.dataSource.createQueryRunner.bind(this.dataSource);
    this.dataSource.createQueryRunner = ((...args: Parameters<DataSource['createQueryRunner']>) => {
      const runner = originalCreateQueryRunner(...args);
      this.instrumentQueryRunner(runner);
      return runner;
    }) as DataSource['createQueryRunner'];
  }

  private instrumentQueryRunner(runner: QueryRunner): void {
    if ((runner as QueryRunner & { __metricsInstrumented?: boolean }).__metricsInstrumented) return;
    (runner as QueryRunner & { __metricsInstrumented?: boolean }).__metricsInstrumented = true;
    const originalQuery = runner.query.bind(runner);
    runner.query = (async (query: string, parameters?: unknown[]) => {
      const startedAt = Date.now();
      try {
        return await originalQuery(query, parameters);
      } finally {
        observeDatabaseQuery(this.queryType(query), startedAt);
      }
    }) as QueryRunner['query'];
  }

  private updatePoolMetrics(): void {
    const pool = (this.dataSource.driver as unknown as { master?: { totalCount?: number; idleCount?: number } }).master;
    if (pool) setDatabasePoolMetrics(pool.totalCount ?? 0, pool.idleCount ?? 0);
  }

  private queryType(query: string): string {
    return query.trim().split(/\s+/, 1)[0]?.toLowerCase() || 'unknown';
  }
}

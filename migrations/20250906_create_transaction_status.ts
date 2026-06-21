import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateTransactionStatusTable1724079600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'transaction_status',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'idempotencyKey',
            type: 'varchar',
            isUnique: true,
            isNullable: false,
          },
          {
            name: 'userId',
            type: 'int',
            isNullable: false,
          },
          {
            name: 'operationType',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'transactionHash',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'status',
            type: "enum",
            enum: ['pending', 'confirmed', 'failed', 'unknown'],
            default: "'pending'",
            isNullable: false,
          },
          {
            name: 'retryCount',
            type: 'int',
            default: 0,
            isNullable: false,
          },
          {
            name: 'errorMessage',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'lastReconciledAt',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'requestParameters',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    // Create indexes for common queries
    await queryRunner.createIndex(
      'transaction_status',
      new TableIndex({
        name: 'idx_transaction_status_idempotency_key',
        columnNames: ['idempotencyKey'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'transaction_status',
      new TableIndex({
        name: 'idx_transaction_status_tx_hash',
        columnNames: ['transactionHash'],
      }),
    );

    await queryRunner.createIndex(
      'transaction_status',
      new TableIndex({
        name: 'idx_transaction_status_user_op',
        columnNames: ['userId', 'operationType'],
      }),
    );

    await queryRunner.createIndex(
      'transaction_status',
      new TableIndex({
        name: 'idx_transaction_status_status',
        columnNames: ['status'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('transaction_status');
  }
}

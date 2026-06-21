import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddIdempotencyKeyToMintTable1724079700000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add idempotencyKey column
    await queryRunner.addColumn(
      'mint',
      new TableColumn({
        name: 'idempotencyKey',
        type: 'varchar',
        isNullable: true,
        isUnique: true,
      }),
    );

    // Add status column
    await queryRunner.addColumn(
      'mint',
      new TableColumn({
        name: 'status',
        type: 'varchar',
        default: "'pending'",
        isNullable: false,
      }),
    );

    // Add timestamps if they don't exist
    const table = await queryRunner.getTable('mint');
    if (!table.findColumnByName('createdAt')) {
      await queryRunner.addColumn(
        'mint',
        new TableColumn({
          name: 'createdAt',
          type: 'timestamp',
          default: 'CURRENT_TIMESTAMP',
          isNullable: false,
        }),
      );
    }

    if (!table.findColumnByName('updatedAt')) {
      await queryRunner.addColumn(
        'mint',
        new TableColumn({
          name: 'updatedAt',
          type: 'timestamp',
          default: 'CURRENT_TIMESTAMP',
          isNullable: false,
        }),
      );
    }

    // Create indexes
    await queryRunner.createIndex(
      'mint',
      new TableIndex({
        name: 'idx_mint_idempotency_key',
        columnNames: ['idempotencyKey'],
        isUnique: true,
      }),
    );

    await queryRunner.createIndex(
      'mint',
      new TableIndex({
        name: 'idx_mint_user_id',
        columnNames: ['userId'],
      }),
    );

    await queryRunner.createIndex(
      'mint',
      new TableIndex({
        name: 'idx_mint_status',
        columnNames: ['status'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('mint');

    // Drop indexes
    const idempotencyKeyIndex = table.indices.find(
      (i) => i.name === 'idx_mint_idempotency_key',
    );
    if (idempotencyKeyIndex) {
      await queryRunner.dropIndex('mint', idempotencyKeyIndex);
    }

    const userIdIndex = table.indices.find(
      (i) => i.name === 'idx_mint_user_id',
    );
    if (userIdIndex) {
      await queryRunner.dropIndex('mint', userIdIndex);
    }

    const statusIndex = table.indices.find(
      (i) => i.name === 'idx_mint_status',
    );
    if (statusIndex) {
      await queryRunner.dropIndex('mint', statusIndex);
    }

    // Drop columns
    await queryRunner.dropColumn('mint', 'idempotencyKey');
    await queryRunner.dropColumn('mint', 'status');
  }
}

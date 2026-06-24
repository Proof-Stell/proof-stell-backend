# Blockchain Transaction Idempotency & State Management

This document describes the implementation of idempotent blockchain transaction handling with proper state reconciliation to prevent duplicate submissions, double-charging users, and ensure consistent wallet state.

## Overview

The system addresses critical security issues where:
- Users could be charged twice if wallet providers report transient failures after transaction broadcast
- Backend could lose track of true transaction outcomes
- Wallet state could become inconsistent or rollback into invalid states

## Architecture

### 1. Idempotency Keys

All blockchain transactions are keyed by a stable **idempotency key** that is generated based on:
- User ID
- Operation Type (mint, transfer, burn)
- Optional nonce (for explicit retries)

```typescript
const key = generateIdempotencyKey(userId, operationType, nonce);
// Generates a stable SHA256 hash that uniquely identifies the operation
```

### 2. Transaction Status Entity

The `TransactionStatus` entity tracks each transaction attempt:

```typescript
{
  idempotencyKey: string;           // Unique identifier (primary lookup key)
  userId: number;                   // Associated user
  operationType: string;            // 'mint', 'transfer', 'burn', etc.
  transactionHash: string;          // Blockchain hash (once broadcast)
  status: 'pending' | 'confirmed' | 'failed' | 'unknown';
  retryCount: number;               // Number of retry attempts
  errorMessage: string;             // Last error (if failed)
  metadata: object;                 // Block number, timestamp, etc.
  lastReconciledAt: Date;          // Last time verified on-chain
  requestParameters: object;        // Original request data
  createdAt: Date;
  updatedAt: Date;
}
```

### 3. Transaction Reconciliation Service

The `TransactionReconciliationService` manages idempotency and prevents duplicate submissions:

#### Check Existing Transaction
```typescript
const existing = await reconciliationService.checkExistingTransaction(idempotencyKey);

if (existing?.status === 'confirmed') {
  // Return existing transaction hash - don't resubmit
  return { transaction_hash: existing.transactionHash };
}
```

#### Record Transaction Attempt
```typescript
const txStatus = await reconciliationService.recordTransactionAttempt({
  userId,
  operationType: 'mint',
  idempotencyKey,
  requestParameters: { userId },
});
```

#### Update After Broadcast
```typescript
await reconciliationService.updateTransactionBroadcast(
  idempotencyKey,
  transactionHash,
);
```

#### Confirm After On-Chain Verification
```typescript
await reconciliationService.updateTransactionConfirmed(
  idempotencyKey,
  { blockNumber: 12345, blockHash: '0x...' },
);
```

### 4. Transaction Verification Service

The `TransactionVerificationService` verifies transaction status on the blockchain:

```typescript
const verification = await verificationService.verifyTransactionOnChain(txHash);

// Returns: { status: 'success' | 'failed' | 'pending' | 'not_found', details: {...} }
```

This enables:
- **Reconciliation after transient errors**: If the provider loses connection after broadcast, we can verify the real status on-chain
- **Automatic confirmation**: Scheduled jobs check pending transactions and update their status based on on-chain reality

### 5. Scheduled Reconciliation

The `TransactionScheduler` runs background jobs to reconcile pending/unknown transactions:

```typescript
@Cron(CronExpression.EVERY_2_MINUTES)
async reconcilePendingTransactions() {
  await verificationService.reconcileAllPendingTransactions();
}
```

## Usage Example

### Minting Tokens

```typescript
// User initiates mint
const mint = await mintService.mint(userId);
// Returns: { idempotencyKey: 'abc123', transactionHash: '0x123', status: 'pending' }

// If the user retries with the same userId (within a short window),
// they'll either get a conflict error (if another pending exists) or
// can provide an explicit nonce for a new attempt
const mint2 = await mintService.mint(userId, 'explicit-nonce');

// Check status
const status = await mintService.getMintStatus(idempotencyKey);
// { status: 'pending' | 'confirmed' | 'failed' }

// Later, when reconciliation confirms the transaction:
await mintService.confirmMint(idempotencyKey);
```

### Blockchain Service

```typescript
const result = await blockchainService.sendMintTx(userId);
// Returns: { transaction_hash: '0x123', idempotencyKey: 'abc' }

// Automatic idempotency - retry with same userId returns same hash
const result2 = await blockchainService.sendMintTx(userId);
// Returns the existing transaction if already confirmed
```

## Protection Against Issues

### 1. Double-Charging Users

**Problem**: User clicks "Mint" twice, both transactions get broadcast.

**Solution**: 
- First transaction is recorded with `idempotencyKey`
- Second request with same userId finds existing pending transaction
- Returns `ConflictException` unless explicit nonce is provided
- Explicit retry with nonce creates a new operation with different idempotency key

```typescript
// First mint
await mintService.mint(1);  // idempotencyKey: 'user1:mint:auto'

// Accidental retry
await mintService.mint(1);  // Throws ConflictException

// Intentional retry with nonce
await mintService.mint(1, 'retry-1');  // idempotencyKey: 'user1:mint:retry-1'
```

### 2. Duplicate Webhook Callbacks

**Problem**: Confirmation webhook is received twice for same transaction.

**Solution**:
- Transaction status is idempotent - confirming twice is safe
- Status lookup by `idempotencyKey` is efficient and exact
- No double state updates

```typescript
// First callback
await mintService.confirmMint(idempotencyKey);  // status: confirmed

// Duplicate callback
await mintService.confirmMint(idempotencyKey);  // Still status: confirmed
// idempotent - safe to call multiple times
```

### 3. Transient Provider Failures

**Problem**: Transaction broadcast succeeds but provider reports error.

**Solution**:
1. Transaction hash is recorded immediately after broadcast
2. If provider later fails, we have the hash recorded
3. Scheduled reconciliation verifies the transaction on-chain
4. Status is updated based on actual blockchain state

```typescript
// Transaction is broadcast and hash is recorded:
// TransactionStatus { hash: '0x123', status: 'pending' }

// If provider reports error, we catch it:
try {
  // provider error occurs
} catch (error) {
  // But we already saved the hash, so reconciliation can verify it
}

// Scheduled job verifies on-chain:
const onChain = await verificationService.verifyTransactionOnChain('0x123');
// If successful on-chain: { status: 'success' }
// Update TransactionStatus to confirmed
```

### 4. Partial Success (Broadcast Success, Confirmation Delay)

**Problem**: Transaction is broadcast but confirmation takes a long time.

**Solution**:
- Transaction starts with status: `pending`
- Reconciliation jobs continuously check on-chain status
- Once confirmed on-chain, status is updated to `confirmed`
- Client can query status at any time

```typescript
const result = await blockchainService.sendMintTx(1);
// { transaction_hash: '0x123', idempotencyKey: 'key1' }
// TransactionStatus.status = 'pending'

// Periodic reconciliation checks:
const onChain = await verificationService.verifyTransactionOnChain('0x123');
// Eventually returns: { status: 'success' }

// Status is updated:
// TransactionStatus.status = 'confirmed'
```

## API Endpoints

### Mint Controller
```
POST /mint/mint
  Request: { }
  Response: { success: true, transactionHash, idempotencyKey, status, explorerUrl }

GET /mint/status/:idempotencyKey
  Response: { status, transactionHash, createdAt, updatedAt }
```

## Database Schema

### transaction_status table
```sql
CREATE TABLE transaction_status (
  id SERIAL PRIMARY KEY,
  idempotencyKey VARCHAR UNIQUE,
  userId INT,
  operationType VARCHAR,
  transactionHash VARCHAR,
  status ENUM('pending', 'confirmed', 'failed', 'unknown'),
  retryCount INT DEFAULT 0,
  errorMessage TEXT,
  metadata JSONB,
  lastReconciledAt TIMESTAMP,
  requestParameters JSONB,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transaction_status_idempotency_key ON transaction_status(idempotencyKey);
CREATE INDEX idx_transaction_status_tx_hash ON transaction_status(transactionHash);
CREATE INDEX idx_transaction_status_user_op ON transaction_status(userId, operationType);
CREATE INDEX idx_transaction_status_status ON transaction_status(status);
```

### mint table updates
```sql
ALTER TABLE mint ADD COLUMN idempotencyKey VARCHAR UNIQUE;
ALTER TABLE mint ADD COLUMN status VARCHAR DEFAULT 'pending';
ALTER TABLE mint ADD COLUMN createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE mint ADD COLUMN updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
```

## Testing

Comprehensive tests cover:

1. **Idempotency Tests**
   - Preventing duplicate submissions of confirmed transactions
   - Allowing retries with different nonces
   - Stable key generation

2. **Network Timeout Tests**
   - Handling transient errors
   - Recording transaction hash before error
   - Allowing recovery via reconciliation

3. **Duplicate Callback Tests**
   - Safe handling of multiple confirmations
   - Preventing double state updates
   - Idempotent webhook processing

4. **Partial Success Tests**
   - Handling broadcast success with confirmation delay
   - Maintaining consistency through reconciliation
   - Status transitions (pending → confirmed)

5. **Atomic Update Tests**
   - Ensuring transaction is only created after broadcast
   - Not creating records if transaction fails
   - Consistent state between TransactionStatus and Mint tables

## Running Tests

```bash
# Run all blockchain tests
npm test -- src/blockchain

# Run specific test file
npm test -- src/blockchain/blockchain.service.spec.ts

# Run with coverage
npm test -- --coverage src/blockchain
```

## Configuration

No additional configuration needed. The system is designed to be automatic:
- Reconciliation jobs run on a 2-minute schedule by default
- Retry limits are configurable (default: 3 retries per transaction)
- Reconciliation timeout is configurable (default: check after 5 minutes of no activity)

## Migration

Run migrations to create the new tables:

```bash
npm run typeorm migration:run
```

This will:
1. Create the `transaction_status` table with proper indexes
2. Add idempotency columns to the `mint` table
3. Create appropriate indexes for efficient querying

## Error Handling

### ConflictException
Thrown when user attempts to create a new mint while one is already pending:
```typescript
throw new ConflictException('A mint transaction is already pending for this user');
```

### BadRequestException
Thrown when attempting to update a transaction that doesn't exist:
```typescript
throw new BadRequestException('Transaction record not found for idempotency key: ${key}');
```

## Monitoring & Logging

The system logs important events for monitoring:
- Transaction broadcast: `"Transaction broadcast recorded: hash=..."`
- Duplicate prevention: `"Duplicate submission prevented: hash=..."`
- Reconciliation: `"Transaction reconciled as confirmed: idempotencyKey=..."`
- Failures: `"Transaction failed after retries: error=..."`

## Acceptance Criteria Checklist

- ✅ Wallet transaction retries are idempotent and keyed by a stable request identifier
- ✅ Provider result reconciliation is performed after transient errors
- ✅ Wallet state updates are atomic and cannot be rolled back into an inconsistent state
- ✅ Tests cover network timeouts, duplicate transaction callbacks, and partial success

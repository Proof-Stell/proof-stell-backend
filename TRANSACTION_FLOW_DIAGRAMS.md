# Blockchain Transaction Flow - Architecture & Flow Diagrams

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     PROOF-STELL BACKEND                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────┐      ┌──────────────────┐                  │
│  │   MintController │      │  MintService     │                  │
│  │    & Routes      │─────▶│  & Business      │                  │
│  │                  │      │   Logic          │                  │
│  └──────────────────┘      └──────────────────┘                  │
│                                     │                             │
│                                     ▼                             │
│  ┌──────────────────┐      ┌──────────────────────────────────┐  │
│  │  Mint Entity     │◀─────│  BlockchainService               │  │
│  │  (Database)      │      │  - sendMintTx()                  │  │
│  │                  │      │  - sendTransferTx()              │  │
│  │ - id             │      │  - sendBurnTx()                  │  │
│  │ - userId         │      │  - Idempotency checks            │  │
│  │ - txHash         │      │  - Status updates                │  │
│  │ - status         │      │  - Error handling                │  │
│  │ - idempotencyKey │      └──────────────────────────────────┘  │
│  └──────────────────┘                     │                      │
│                                           ▼                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  TransactionStatus Entity (Database)                    │    │
│  │                                                          │    │
│  │ - idempotencyKey (PRIMARY LOOKUP)                       │    │
│  │ - userId, operationType                                │    │
│  │ - transactionHash                                       │    │
│  │ - status (pending/confirmed/failed/unknown)            │    │
│  │ - retryCount, errorMessage                             │    │
│  │ - metadata, requestParameters                          │    │
│  │ - lastReconciledAt                                     │    │
│  └─────────────────────────────────────────────────────────┘    │
│         ▲              │                          │              │
│         │              │                          ▼              │
│  ┌──────────────────────────────┐  ┌────────────────────────┐   │
│  │TransactionReconciliation     │  │TransactionVerification │   │
│  │      Service                 │  │      Service           │   │
│  │                              │  │                        │   │
│  │- checkExistingTransaction()  │  │- verifyOnChain()       │   │
│  │- recordAttempt()             │  │- reconcileTransaction()│   │
│  │- updateBroadcast()           │  │- reconcileAll()       │   │
│  │- updateConfirmed()           │  └────────────────────────┘   │
│  │- updateFailed()              │           │                   │
│  │- markUnknownStatus()         │           ▼                   │
│  └──────────────────────────────┘  ┌────────────────────────┐   │
│                                    │  TransactionScheduler  │   │
│                                    │                        │   │
│                                    │- Every 2 min:          │   │
│                                    │  reconcilePending...() │   │
│                                    │- Every 10 min:         │   │
│                                    │  deepReconciliation()  │   │
│                                    └────────────────────────┘   │
│                                             │                   │
└─────────────────────────────────────────────┼───────────────────┘
                                              │
                    ┌─────────────────────────▼───────────────────┐
                    │  STARKNET BLOCKCHAIN                        │
                    │  - Transaction Broadcast                    │
                    │  - On-Chain Execution                       │
                    │  - Block Finalization                       │
                    └───────────────────────────────────────────┘
```

## Transaction Lifecycle Flow

### Happy Path: Successful Mint

```
USER
  │
  ▼
POST /mint/mint
  │
  ▼
MintController.mint(userId)
  │
  ├─▶ MintService.mint(userId)
  │   │
  │   ├─▶ Check existing pending mint for userId
  │   │   └─ If exists and no nonce: throw ConflictException
  │   │
  │   ├─▶ BlockchainService.sendMintTx(userId)
  │   │   │
  │   │   ├─▶ Generate idempotencyKey = hash(userId:mint:nonce)
  │   │   │
  │   │   ├─▶ ReconciliationService.checkExistingTransaction(key)
  │   │   │   └─ If confirmed: return existing hash (no resubmit)
  │   │   │
  │   │   ├─▶ ReconciliationService.recordTransactionAttempt()
  │   │   │   └─ Create TransactionStatus with status=pending
  │   │   │
  │   │   ├─▶ Provider.execute() - broadcast transaction
  │   │   │   └─ Returns: transaction_hash
  │   │   │
  │   │   ├─▶ ReconciliationService.updateTransactionBroadcast(key, hash)
  │   │   │   └─ Update TransactionStatus with hash
  │   │   │
  │   │   ├─▶ Analytics.track(TokenMinted)
  │   │   │
  │   │   └─▶ Return { transaction_hash, idempotencyKey }
  │   │
  │   ├─▶ Create Mint record with:
  │   │   - userId
  │   │   - transactionHash
  │   │   - idempotencyKey
  │   │   - status = 'pending'
  │   │
  │   └─▶ Return Mint record
  │
  └─▶ Return HTTP 200
      {
        success: true,
        transactionHash: '0x123...',
        idempotencyKey: 'abc123...',
        status: 'pending',
        explorerUrl: 'https://voyager.online/tx/0x123...'
      }

[TIME PASSES - Transaction is on-chain]

TransactionScheduler (every 2 minutes)
  │
  ├─▶ ReconciliationService.getTransactionsNeedingReconciliation()
  │   └─ Query TransactionStatus where status=pending
  │
  ├─▶ For each pending transaction:
  │   │
  │   ├─▶ VerificationService.reconcileTransaction(idempotencyKey)
  │   │
  │   ├─▶ VerificationService.verifyTransactionOnChain(hash)
  │   │   │
  │   │   ├─▶ Provider.getTransactionReceipt(hash)
  │   │   │
  │   │   └─▶ Check execution_status
  │   │       - If 'SUCCEEDED': return { status: 'success' }
  │   │       - If 'FAILED': return { status: 'failed', reason: '...' }
  │   │       - If 'PENDING': return { status: 'pending' }
  │   │
  │   └─▶ ReconciliationService.updateTransactionConfirmed(key, metadata)
  │       └─ Update TransactionStatus: status=confirmed
  │
  └─▶ Update Mint record: status='confirmed'

[CLIENT POLLS STATUS]

GET /mint/status/:idempotencyKey
  │
  ├─▶ MintService.getMintStatus(idempotencyKey)
  │   │
  │   ├─▶ Query Mint by idempotencyKey
  │   │
  │   └─▶ Return { status: 'confirmed', transactionHash, ... }
  │
  └─▶ Return HTTP 200
      {
        status: 'confirmed',
        transactionHash: '0x123...',
        createdAt: '2026-01-01T10:00:00Z',
        updatedAt: '2026-01-01T10:02:00Z'
      }
```

## Network Failure Recovery Path

```
USER
  │
  ▼
POST /mint/mint
  │
  ├─▶ BlockchainService.sendMintTx(userId)
  │   │
  │   ├─▶ ReconciliationService.recordTransactionAttempt()
  │   │   └─ Create TransactionStatus (status=pending)
  │   │
  │   ├─▶ Provider.execute() - broadcast successful
  │   │   └─ transaction_hash = '0x123...'
  │   │
  │   ├─▶ ReconciliationService.updateTransactionBroadcast(key, '0x123')
  │   │   └─ Update TransactionStatus with hash
  │   │
  │   └─▶ Network Error! (connection lost to provider)
  │       └─ Throws: NetworkTimeoutError
  │
  ├─ Exception caught
  │ │
  │ └─▶ ReconciliationService.updateTransactionFailed(key, error)
  │     └─ Update TransactionStatus: 
  │        - status = 'failed'
  │        - errorMessage = 'Network timeout'
  │        - retryCount = 1
  │
  └─▶ Throw error to user
      User sees: "Transaction submission failed, please retry"

[BUT... Transaction was actually broadcast!]

[SCHEDULED RECONCILIATION RUNS]

TransactionScheduler (every 2 minutes)
  │
  ├─▶ ReconciliationService.getTransactionsNeedingReconciliation()
  │   └─ Returns: transactions with status=failed or status=unknown
  │
  ├─▶ VerificationService.verifyTransactionOnChain('0x123')
  │   │
  │   └─▶ Provider.getTransactionReceipt('0x123')
  │       └─ Returns: successful receipt!
  │
  ├─▶ ReconciliationService.updateTransactionConfirmed(key)
  │   └─ Update TransactionStatus: status='confirmed'
  │
  └─▶ Log: "Transaction recovered from failure, now confirmed"

[USER RETRIES OR POLLS STATUS]

GET /mint/status/:idempotencyKey
  │
  └─▶ Return: { status: 'confirmed', transactionHash: '0x123' }
      Success! Transaction was confirmed despite the network error.
```

## Duplicate Submission Protection Path

```
USER
  │
  ├─ Click "Mint" button
  │  │
  │  ▼
  │  POST /mint/mint
  │  │
  │  ├─▶ BlockchainService.sendMintTx(userId=1)
  │  │   │
  │  │   ├─▶ idempotencyKey = hash('1:mint:auto')
  │  │   │
  │  │   ├─▶ ReconciliationService.recordTransactionAttempt()
  │  │   │   └─ Create TransactionStatus
  │  │   │
  │  │   ├─▶ Broadcast transaction → hash '0xAAA'
  │  │   │
  │  │   ├─▶ ReconciliationService.updateTransactionBroadcast(key, '0xAAA')
  │  │   │
  │  │   └─▶ Return { transaction_hash: '0xAAA', idempotencyKey }
  │  │
  │  ├─▶ MintService.mint() saves Mint record
  │  │   └─ status = 'pending'
  │  │
  │  └─▶ Return { success: true, transactionHash: '0xAAA', ... }
  │
  │ [Network latency - response takes 5 seconds]
  │
  ├─ User doesn't see response, clicks "Mint" again
  │  │
  │  ▼
  │  POST /mint/mint (same user)
  │  │
  │  ├─▶ MintService.mint(userId=1)
  │  │   │
  │  │   ├─▶ Check existing pending mint for userId=1
  │  │   │   └─ FOUND: Mint record from first request (status=pending)
  │  │   │
  │  │   └─▶ Throw ConflictException
  │  │       "A mint transaction is already pending for this user"
  │  │
  │  └─▶ Return HTTP 409 Conflict
  │      Error: "A mint transaction is already pending"
  │
  └─ User sees error and waits, or retries with explicit nonce

[IF USER RETRIES WITH NONCE]

POST /mint/mint (with nonce='retry-1')
  │
  ├─▶ MintService.mint(userId=1, nonce='retry-1')
  │   │
  │   ├─▶ Check existing pending - found, but has nonce
  │   │   └─ Allow retry (different nonce = different operation)
  │   │
  │   └─▶ BlockchainService.sendMintTx(userId=1, nonce='retry-1')
  │       │
  │       └─▶ idempotencyKey = hash('1:mint:retry-1')
  │           └─ DIFFERENT from first attempt!
  │
  └─▶ New transaction created with separate idempotencyKey
      Both transactions tracked independently
```

## Webhook Callback Safety Path

```
[TRANSACTION CONFIRMED ON-CHAIN]

Provider sends webhook: 
  POST /webhook/transaction-confirmed
  {
    transactionHash: '0x123...',
    idempotencyKey: 'abc...'
  }

Request 1 (First webhook callback)
  │
  ├─▶ MintService.confirmMint(idempotencyKey)
  │   │
  │   ├─▶ ReconciliationService.updateTransactionConfirmed(key)
  │   │   └─ TransactionStatus: status='confirmed'
  │   │
  │   ├─▶ Query Mint by idempotencyKey
  │   │   └─ Found: Mint record
  │   │
  │   ├─▶ Update Mint: status='confirmed'
  │   │
  │   └─▶ Return updated Mint record
  │
  └─▶ Return HTTP 200 OK

Request 2 (Webhook retried due to network - DUPLICATE)
  │
  ├─▶ MintService.confirmMint(idempotencyKey)
  │   │
  │   ├─▶ ReconciliationService.updateTransactionConfirmed(key)
  │   │   └─ TransactionStatus already confirmed
  │   │       └─ Just updates lastReconciledAt timestamp
  │   │       └─ Idempotent operation - safe!
  │   │
  │   ├─▶ Query Mint by idempotencyKey
  │   │   └─ Found: Mint record (already confirmed)
  │   │
  │   ├─▶ Update Mint: status='confirmed'
  │   │   └─ Setting to same value - safe!
  │   │
  │   └─▶ Return updated Mint record
  │
  └─▶ Return HTTP 200 OK
      Database is in exact same state - NO double-charging!

Result: Even though webhook was received twice,
        no duplicate state updates occurred.
        User is charged exactly once.
```

## Database State Transitions

### TransactionStatus State Machine

```
                    ┌──────────────┐
                    │    START     │
                    └──────┬───────┘
                           │
        ┌──────────────────▼──────────────────┐
        │  recordTransactionAttempt()         │
        │  status = 'PENDING'                │
        │  retryCount = 1                    │
        │  transactionHash = NULL            │
        └──────────────────┬──────────────────┘
                           │
        ┌──────────────────▼──────────────────┐
        │  updateTransactionBroadcast()      │
        │  status = 'PENDING'                │
        │  transactionHash = <hash>          │
        │  lastReconciledAt = NOW()          │
        └──────────────────┬──────────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
    (Confirm)        (Fail)            (Unknown)
          │                │                │
          │                ▼                ▼
    ┌─────────────┐  ┌──────────┐  ┌──────────────┐
    │ CONFIRMED   │  │  FAILED  │  │   UNKNOWN    │
    │             │  │          │  │              │
    │ Mined ✓     │  │ Error    │  │ Need to      │
    │ Final ✓     │  │ Recorded │  │ reconcile    │
    └─────────────┘  └────┬─────┘  └────┬─────────┘
                          │              │
                     [Retry with         │
                      nonce]             │
                          │         [Scheduled
                          │          reconciliation]
                          ▼              ▼
                    ┌──────────────────────────┐
                    │  updateTransactionRetry()│
                    │  status = 'PENDING'      │
                    │  retryCount++            │
                    │  errorMessage = NULL     │
                    └──────────────────────────┘
```

### Mint Entity State Machine

```
                    ┌──────────────┐
                    │    START     │
                    └──────┬───────┘
                           │
        ┌──────────────────▼──────────────────┐
        │  mint()                            │
        │  status = 'PENDING'                │
        │  transactionHash = <hash>          │
        │  idempotencyKey = <key>            │
        └──────────────────┬──────────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
    (Confirm)         (Fail)            (Timeout)
          │                │                │
    ┌─────────────┐  ┌──────────┐  ┌──────────────┐
    │ CONFIRMED   │  │  FAILED  │  │   PENDING    │
    │             │  │          │  │              │
    │ Tokens ✓    │  │ Need to  │  │ Wait for     │
    │ Verified ✓  │  │ retry    │  │ reconcile    │
    └─────────────┘  └──────────┘  └──────────────┘
```

## Key Protection Mechanisms

### 1. Idempotency Key Uniqueness
```
INSERT INTO transaction_status (idempotencyKey, ...)
  VALUES ('abc123', ...)
  
// If same idempotencyKey attempted again:
// Database constraint prevents duplicate insert
// Check returns existing record instead
```

### 2. Transaction Hash Durability
```
1. Broadcast transaction → get hash
2. IMMEDIATELY save hash to database
3. If anything fails after this:
   - Hash is safely stored
   - Reconciliation can verify later
4. No lost transaction hashes
```

### 3. Atomic Status Updates
```
TransactionStatus: idempotencyKey=KEY1, hash=HASH1, status=PENDING
     ↓
     └─→ On-chain verified
     ↓
TransactionStatus: idempotencyKey=KEY1, hash=HASH1, status=CONFIRMED

Mint: idempotencyKey=KEY1, status=PENDING
     ↓
     └─→ Receive confirmation
     ↓
Mint: idempotencyKey=KEY1, status=CONFIRMED

Both tables updated consistently via idempotencyKey FK relationship
```

## Monitoring & Observability

### Critical Logs

```
# Success path
"Transaction broadcast recorded: idempotencyKey=abc, hash=0x123"
"Transaction confirmed: idempotencyKey=abc, hash=0x123"

# Failure recovery
"Transient error sending transaction: error=timeout, retrying..."
"Transaction failed after 3 attempts: error=network down"
"Transaction status marked as unknown: idempotencyKey=abc"

# Duplicate prevention
"Duplicate submission prevented: idempotencyKey=abc, returning=0x123"
"User already has pending mint: userId=1, blocking second request"

# Reconciliation
"Starting scheduled transaction reconciliation..."
"Reconciling 5 pending transactions"
"Transaction reconciled as confirmed: idempotencyKey=abc"
```

### Metrics

```
Key metrics to track:
- idempotency_hits: Times prevented resubmission
- duplicate_submissions_blocked: Number of duplicate blocks
- transactions_recovered: Recovered from transient failures
- reconciliation_success_rate: % of pending → confirmed
- average_confirmation_time: Time from broadcast to confirmation
- transaction_status_queries: API load on status endpoint
```

This architecture ensures safe, idempotent blockchain operations with automatic recovery from transient failures.

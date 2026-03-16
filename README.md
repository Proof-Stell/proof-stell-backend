
ProofStell Backend API 🖥 

Decentralized Document Verification & Credential Registry on Stellar Soroban

ProofStell is a decentralized platform built on Soroban smart contracts that allows institutions, organizations, and individuals to issue, verify, and manage tamper-proof digital credentials and documents.

Instead of trusting centralized databases, ProofDesk anchors cryptographic proofs of documents on-chain, ensuring authenticity, permanence, and global verifiability.

From academic certificates to employment records and compliance documents, ProofDesk creates a trustless verification infrastructure powered by Stellar User interface for the ProofStell decentralized document verification platform.

🚀 Key Features 📄 On-Chain Document Proofs

Institutions can register documents by storing cryptographic hashes on-chain via Soroban smart contracts.

Anyone can verify a document’s authenticity by comparing its hash with the blockchain record.

🏫 Institutional Issuers

Verified institutions (schools, companies, NGOs) can issue credentials directly to users’ wallets.

Examples:

University certificates

Employment letters

Training certifications

Compliance approvals

🔐 Wallet-Based Identity

Users connect their Stellar wallets to:

Receive credentials

Share verifiable proofs

Manage issued documents

No usernames or passwords required.

🔎 Instant Verification

Third parties can verify documents in seconds:

Upload the document

Platform hashes the file

Hash is matched with the blockchain record

Result: Valid / Not Found / Revoked

🧾 Revocation Registry

Issuers can revoke credentials if necessary.

Example cases:

Fraudulent certificates

Expired compliance documents

Recalled licenses

The revocation state is stored on-chain for full transparency.

The frontend enables users, institutions, and third parties to interact with the ProofStell ecosystem.

Users can:

• Upload documents • Verify document authenticity • View issued credentials • Connect Stellar wallets

Overview

ProofStell allows anyone to verify documents in seconds.

Backend services for the ProofStell decentralized document verification platform.

The backend acts as the middleware between the frontend application and the Soroban smart contracts deployed on the Stellar network.

It handles:

• Document hashing
• Issuer verification
• Metadata storage
• Smart contract interaction
• API services for the frontend

Architecture

Frontend (Next.js)
|
v
Backend API (NestJS)
|
v
Soroban Smart Contract
|
v
Stellar Network

Core Responsibilities

Document Processing
Handles document uploads and generates SHA256 hashes.

Blockchain Interaction
Calls Soroban contract functions.

Metadata Storage
Stores document metadata in PostgreSQL.

Verification Services
Allows third parties to verify documents.

Technology Stack

Framework
NestJS

Database
PostgreSQL

ORM
Prisma

Blockchain SDK
Stellar Soroban SDK

File Handling
Multer

Hashing
Crypto SHA256

Project Structure
src
│
├── auth
│
├── documents
│   ├── documents.controller.ts
│   ├── documents.service.ts
│   └── documents.module.ts
│
├── issuers
│
├── verification
│
├── soroban
│   ├── soroban.service.ts
│   └── contract-client.ts
│
├── prisma
│
└── utils
API Endpoints

Issue Document

POST /documents/issue

Registers a document on-chain.

Request

{
  "issuerId": "org123",
  "walletAddress": "GXXXXXX",
  "documentHash": "abc123..."
}

Verify Document

POST /verify

Uploads a document and checks if it exists on-chain.

Response

{
  "status": "verified",
  "issuer": "UniversityX",
  "timestamp": "..."
}

Revoke Document

POST /documents/revoke

Revokes an existing credential.

Running the Backend

Install dependencies

npm install

Run development server

npm run start:dev
Environment Variables
DATABASE_URL=
SOROBAN_RPC_URL=
STELLAR_NETWORK=
CONTRACT_ADDRESS=

🛠️ Contributing to Proof-Stell Backend
Welcome to the Proof-Stell Backend — the decentralized backend service behind Proof-Stell, a competitive whack-a-mole game built on StarkNet. By leveraging smart contracts, on-chain leaderboards, and wallet-based identity, Proof-Stell offers a fair, fun, and verifiable gaming experience for everyone.

We’re thrilled you’re here! Whether you're building features, squashing bugs, or improving documentation — your contribution pushes the future of decentralized gaming forward.

⚙️ Setup Instructions
1. Fork the Project
Start by forking the repo on GitHub.

2. Clone the Repository
git clone https://github.com/Proof-Stell/proof-stell-backend
cd Proof-Stell-Backend

3. Create Your Feature Branch
git checkout -b feature/amazing-feature

4. Install Dependencies
npm install

5. Configure Environment Variables
Create a .env file in the root directory based on .env.example:
  
6. Start the Development Server
npm run start:dev
The app will be available at:
📍 http://localhost:3000

🛰️ Running Services
🛢️ PostgreSQL Database for storing game sessions and player stats

📄 Swagger UI at http://localhost:3000/api for API documentation

🌐 StarkNet node for on-chain game data interactions (via sequencer or gateway)

💅 Code Style Guidelines
Use idiomatic TypeScript

Follow NestJS conventions (service-controller-module architecture)

Use Prettier and ESLint for clean, consistent code

Maintain organized and modular folder structures

🌳 Git Workflow
Branching Strategy
main: Production-ready releases

develop: Staging branch with the latest tested features

feature/*: New features

bugfix/*: Bug fixes

Commit Messages (Conventional Commits)
Examples:

feat: add leaderboard endpoint

fix: resolve wallet auth bug

chore: update dependencies

✅ Testing Guidelines
Framework
Jest

Test Types
Unit Tests: Test core logic and service methods

Integration Tests: Ensure correct communication between modules

Running Tests

npm run test
📚 Documentation
Auto-generate API docs using Swagger

Add internal documentation to src/modules/{module}/README.md

Keep the main README.md updated with usage and architecture

🔒 Security Guidelines
Store secrets in environment variables

Use JWT for secure user sessions

Sanitize and validate inputs using class-validator

Follow best practices around wallet authentication and rate-limiting

🎮 Contribute to Decentralized Gaming
Proof-Stell is more than a game — it's an experiment in fair play and on-chain competition. Join our community of builders bringing fun and transparency to Web3 gaming!


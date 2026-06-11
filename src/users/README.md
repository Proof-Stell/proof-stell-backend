# User Module

The User module handles user management, authentication, and role-based access control for the Proof-Stell Backend.

## Features

- **User Registration & Authentication**: Secure user registration and login with JWT tokens
- **Password Security**: Bcrypt hashing with configurable salt rounds
- **Role-Based Access Control (RBAC)**: Admin and Player roles with protected endpoints
- **Profile Management**: Users can view and update their profiles
- **Wallet Integration**: Support for StarkNet wallet addresses
- **Data Transfer Objects**: Secure data handling with validation and transformation

## Entities

### User Entity
- `id`: UUID primary key
- `email`: Unique email address
- `username`: Unique username (3-30 characters)
- `password`: Bcrypt hashed password (excluded from responses)
- `role`: User role (Admin/Player)
- `walletAddress`: Optional StarkNet wallet address
- `isActive`: Account status
- `lastLogin`: Last login timestamp
- `createdAt`: Account creation date
- `updatedAt`: Last update timestamp

## API Endpoints

### Authentication
- `POST /auth/register` - Register a new user account
- `POST /auth/login` - Login with email and password

### User Management
- `GET /users` - Get all users (Admin only)
- `GET /users/profile` - Get current user profile
- `GET /users/:id` - Get user by ID (Admin only)
- `PATCH /users/profile` - Update current user profile
- `PATCH /users/:id` - Update user by ID (Admin only)
- `PATCH /users/profile/change-password` - Change password
- `DELETE /users/:id` - Delete user (Admin only)

## Security Features

- **Password Requirements**: Minimum 8 characters with uppercase, lowercase, number, and special character
- **JWT Authentication**: Secure token-based authentication
- **Role-based Guards**: Protect endpoints based on user roles
- **Password Hashing**: Bcrypt with configurable salt rounds
- **Input Validation**: Comprehensive DTO validation
- **Data Sanitization**: Passwords never returned in responses

## Usage Example

\`\`\`typescript
// Register a new user
const registerDto = {
  email: 'player@example.com',
  username: 'player1',
  password: 'SecurePass123!',
  walletAddress: '0x1234...'
};

// Login
const loginDto = {
  email: 'player@example.com',
  password: 'SecurePass123!'
};
\`\`\`

## Role-Based Access Control

### Player Role
- Can view and update their own profile
- Can change their password
- Can access game-related endpoints

### Admin Role
- All Player permissions
- Can view all users
- Can create, update, and delete users
- Can manage system settings

## Environment Variables

\`\`\`env
JWT_SECRET=your-super-secret-jwt-key-here
JWT_EXPIRES_IN=7d
BCRYPT_SALT_ROUNDS=12

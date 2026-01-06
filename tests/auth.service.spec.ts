jest.mock('../src/auth/auth.repository', () => ({
  __esModule: true,
  findUserByEmail: jest.fn(async (email: string) => ({
    id: 'u1',
    email,
    password: 'hashed',
    role: 'USER',
    photo_profile: null,
    isVerified: true,
  })),
}));

jest.mock('bcrypt', () => ({
  __esModule: true,
  default: {
    compare: jest.fn(async () => true),
  },
}));

import { loginUserService } from '../src/auth/auth.service';

describe('Auth Service', () => {
  it('login menghasilkan token JWT', async () => {
    process.env.JWT_SECRET = 'super-secret-key';
    const result = await loginUserService('test@example.com', 'password');
    expect(typeof result.token).toBe('string');
    expect(result.user.email).toBe('test@example.com');
  });
});

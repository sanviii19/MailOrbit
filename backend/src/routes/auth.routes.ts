import { Router } from 'express';
import passport from 'passport';
import * as authController from '../controllers/auth.controller';
import { authenticate } from '../middleware/authenticate';

const router = Router();

// Email / Password
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.me);

// Google OAuth
// Step 1: Redirect to Google
router.get(
  '/google',
  passport.authenticate('google', { session: false, scope: ['profile', 'email'], prompt: 'select_account' }),
);

// Step 2: Google redirects back here — Passport verifies and calls googleCallback
router.get(
  '/google/callback',
  passport.authenticate('google', {
    session: false,
    failureRedirect: `${process.env['FRONTEND_URL'] ?? 'http://localhost:5173'}/login?error=oauth_failed`,
  }),
  authController.googleCallback,
);

export default router;

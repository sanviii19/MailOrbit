import passport from 'passport';
import { Strategy as GoogleStrategy, Profile } from 'passport-google-oauth20';
import { env } from '../config/env';
import { db } from '../db/client';
import type { DbUser } from '../types';

/**
 * Google OAuth 2.0 strategy.
 * We do NOT use sessions — Passport is used only to complete the OAuth handshake.
 * After verification we issue our own JWT pair and redirect the user.
 */
passport.use(
  new GoogleStrategy(
    {
      clientID: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackURL: env.GOOGLE_CALLBACK_URL,
      scope: ['profile', 'email'],
    },
    async (
      _accessToken: string,
      _refreshToken: string,
      profile: Profile,
      done: (err: unknown, user?: DbUser | false) => void,
    ) => {
      try {
        const googleEmail =
          profile.emails?.[0]?.value ?? null;

        if (!googleEmail) {
          return done(null, false);
        }

        // Upsert: find by google_id first, then by email (account linking)
        let user = await db<DbUser>('users')
          .where('google_id', profile.id)
          .first();

        if (!user) {
          user = await db<DbUser>('users').where('email', googleEmail).first();
        }

        if (user) {
          // Update google_id and avatar if this is a linked account
          const updates: Partial<DbUser> = {};
          if (!user.google_id) updates.google_id = profile.id;
          if (profile.photos?.[0]?.value && !user.avatar_url) {
            updates.avatar_url = profile.photos[0].value;
          }
          if (Object.keys(updates).length > 0) {
            await db('users').where('id', user.id).update({
              ...updates,
              updated_at: db.fn.now(),
            });
            user = { ...user, ...updates };
          }
        } else {
          // New user via Google
          [user] = await db<DbUser>('users')
            .insert({
              google_id: profile.id,
              email: googleEmail,
              name: profile.displayName ?? googleEmail.split('@')[0],
              avatar_url: profile.photos?.[0]?.value ?? null,
              password_hash: null,
            })
            .returning('*');
        }

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    },
  ),
);

// We use passport only for the OAuth dance — no session serialization needed
passport.serializeUser(() => {/* no-op */});
passport.deserializeUser(() => {/* no-op */});

export default passport;

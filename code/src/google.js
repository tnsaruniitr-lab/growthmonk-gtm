import { google } from 'googleapis';
import { config } from './config.js';

let client = null;

// OAuth2 client authenticated via the stored refresh token.
// Returns null if Google credentials are not configured.
export function googleClient() {
  if (client) return client;
  const { clientId, clientSecret, refreshToken } = config.google;
  if (!clientId || !clientSecret || !refreshToken) return null;
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  client = auth;
  return client;
}

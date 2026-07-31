import axios from 'axios';

// Get the backend URL from environment or default to localhost
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true, // required for httpOnly refresh cookies
});

// A variable to store the in-memory access token
let accessToken: string | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

export const getAccessToken = () => accessToken;

// Request Interceptor: Attach the access token to every request
api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// Global lock for token refresh to prevent concurrent requests
let refreshPromise: Promise<string | null> | null = null;

// Response Interceptor: Handle 401 Unauthorized for token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If the error is 401 and it's not a login/refresh request
    if (
      error.response?.status === 401 && 
      !originalRequest._retry && 
      !originalRequest.url?.includes('/auth/login') &&
      !originalRequest.url?.includes('/auth/refresh')
    ) {
      originalRequest._retry = true;

      try {
        if (!refreshPromise) {
          refreshPromise = axios.post(
            `${API_URL}/auth/refresh`,
            {},
            { withCredentials: true }
          ).then(res => {
            if (res.data?.data?.accessToken) {
              setAccessToken(res.data.data.accessToken);
              return res.data.data.accessToken;
            }
            return null;
          }).catch(err => {
            setAccessToken(null);
            window.dispatchEvent(new Event('auth:unauthorized'));
            throw err;
          }).finally(() => {
            refreshPromise = null;
          });
        }

        const newAccessToken = await refreshPromise;

        if (newAccessToken) {
          // Update the failed request's header and retry
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
          return api(originalRequest);
        }
      } catch (refreshError) {
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

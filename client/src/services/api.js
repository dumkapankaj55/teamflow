import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

let accessToken = null;
let refreshRequest = null;

export function setAccessToken(token) {
  const nextToken = token || null;
  if (nextToken !== accessToken) {
    accessToken = nextToken;
    window.dispatchEvent(new Event('teamflow:access-token-updated'));
  }
}

export function getAccessToken() { return accessToken; }

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  const organizationId = localStorage.getItem('teamflow.activeOrganization');
  if (organizationId) config.headers['X-Organization-Id'] = organizationId;
  return config;
});

api.interceptors.response.use((response) => response, async (error) => {
  const originalRequest = error.config;
  const isAuthCall = originalRequest?.url?.includes('/auth/');
  if (error.response?.status !== 401 || !originalRequest || originalRequest._retried || isAuthCall) {
    return Promise.reject(error);
  }

  originalRequest._retried = true;
  try {
    if (!refreshRequest) {
      refreshRequest = api.post('/auth/refresh')
        .then((response) => response.data?.data?.accessToken)
        .finally(() => { refreshRequest = null; });
    }
    const token = await refreshRequest;
    if (!token) throw new Error('Session expired');
    setAccessToken(token);
    originalRequest.headers.Authorization = `Bearer ${token}`;
    return api(originalRequest);
  } catch (refreshError) {
    setAccessToken(null);
    window.dispatchEvent(new Event('teamflow:session-expired'));
    return Promise.reject(refreshError);
  }
});
